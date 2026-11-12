import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../logger";
import { Agent } from "./agent";

const mocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  createResponse: vi.fn(),
  getCitiesNames: vi.fn(),
  conversations: new Map<string, string>(),
}));

vi.mock("openai", () => ({
  default: class {
    conversations = { create: mocks.createConversation };
    responses = { create: mocks.createResponse };
  },
}));

vi.mock("keyv", () => ({
  default: class {
    get = async (key: string) => mocks.conversations.get(key);
    set = async (key: string, value: string) =>
      mocks.conversations.set(key, value);
  },
}));

vi.mock("../onTap/ontap-service", () => ({
  OntapService: {
    getInstance: () => ({ getCitiesNames: mocks.getCitiesNames }),
  },
}));

const stream = async function* (events: object[]) {
  yield* events;
};

const completed = { type: "response.completed" };
const textStream = () =>
  stream([
    { type: "response.output_text.delta", delta: "Cześć" },
    { type: "response.output_text.delta", delta: "!" },
    completed,
  ]);

describe("Agent Responses API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.conversations.clear();
    mocks.createConversation.mockResolvedValue({ id: "conv_test" });
    mocks.createResponse.mockImplementation(textStream);
  });

  it("streams text and reuses a hosted conversation across agent instances", async () => {
    const agent = new Agent("user", logger);
    const onMessage = vi.fn();
    const onDone = vi.fn();
    agent.on("assistantMessage", onMessage);
    agent.on("assistantMessageDone", onDone);

    await agent.sendMessage("Hi");
    await new Agent("user", logger).sendMessage("Again");

    expect(mocks.createConversation).toHaveBeenCalledTimes(1);
    expect(mocks.createResponse).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conversation: "conv_test",
        model: "gpt-6-luna",
        reasoning: { effort: "none" },
        store: true,
        stream: true,
        input: [{ role: "user", content: "Again" }],
      }),
    );
    expect(onMessage).toHaveBeenLastCalledWith({
      delta: "!",
      snapshot: { value: "Cześć!" },
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("executes multiple tool rounds using call IDs without replaying history", async () => {
    const agent = new Agent("tools", logger);
    mocks.getCitiesNames.mockResolvedValue(["Kraków", "Warszawa"]);
    const toolStream = (callId: string) =>
      stream([
        {
          type: "response.output_item.done",
          item: {
            type: "function_call",
            name: "getCitiesNames",
            arguments: "{}",
            call_id: callId,
          },
        },
        completed,
      ]);
    mocks.createResponse
      .mockImplementationOnce(() => toolStream("call_1"))
      .mockImplementationOnce(() => toolStream("call_2"));
    const onDone = vi.fn();
    agent.on("assistantMessageDone", onDone);

    await agent.sendMessage("Cities?");

    expect(mocks.createResponse).toHaveBeenCalledTimes(3);
    expect(mocks.createResponse).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        conversation: "conv_test",
        input: [
          {
            type: "function_call_output",
            call_id: "call_2",
            output: "Kraków, Warszawa",
          },
        ],
      }),
    );
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent messages for the same user across instances", async () => {
    await Promise.all([
      new Agent("same-user", logger).sendMessage("First"),
      new Agent("same-user", logger).sendMessage("Second"),
    ]);

    expect(mocks.createConversation).toHaveBeenCalledTimes(1);
    expect(mocks.createResponse).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        input: [{ role: "user", content: "First" }],
      }),
    );
    expect(mocks.createResponse).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        input: [{ role: "user", content: "Second" }],
      }),
    );
  });

  it("rejects failed streams and allows subsequent messages", async () => {
    const agent = new Agent("failure", logger);
    const onDone = vi.fn();
    agent.on("assistantMessageDone", onDone);
    mocks.createResponse.mockImplementationOnce(() =>
      stream([
        {
          type: "response.failed",
          response: { error: { message: "API failed" } },
        },
      ]),
    );

    await expect(agent.sendMessage("Hi")).rejects.toThrow("API failed");
    expect(onDone).not.toHaveBeenCalled();
    await expect(agent.sendMessage("Retry")).resolves.toBeUndefined();
  });

  it("does not report success for a truncated stream", async () => {
    mocks.createResponse.mockImplementationOnce(() => stream([]));
    await expect(
      new Agent("truncated", logger).sendMessage("Hi"),
    ).rejects.toThrow("Response stream ended before completion");
  });
});
