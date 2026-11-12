import OpenAI from "openai";
import { OntapService } from "../onTap/ontap-service";
import Keyv from "keyv";
import {
  ResponseFunctionToolCall,
  ResponseInput,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import "dotenv/config";
import { EventEmitter } from "events";
import { agentConfig } from "./agent-config";
import type Pino from "pino";
import { IUserMessagePayload } from "../types/events";

import { executeTool } from "./execute-tool";
import { getToolCacheKey } from "./get-tool-cache-key";

const onTap = OntapService.getInstance();

const persistentDataPath = process.env.PERSISTENT_DATA_PATH || ".";
const keyv = new Keyv<string>(`sqlite://${persistentDataPath}/db.sqlite`);
const pendingMessages = new Map<string, Promise<void>>();

export class Agent extends EventEmitter {
  private openai: OpenAI;
  private logger: Pino.Logger;

  private readonly userId;

  constructor(userId: string, userLogger: Pino.Logger) {
    super();

    this.logger = userLogger;
    this.userId = userId;

    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    this.on("userMessage", (payload: IUserMessagePayload) => {
      void this.sendMessage(payload.message).catch((error: unknown) => {
        this.logger.error({ err: error }, "Failed to process message");
        this.emit("assistantError", error);
      });
    });
  }

  public async sendMessage(message: string): Promise<void> {
    const previous = pendingMessages.get(this.userId) || Promise.resolve();
    const pending = previous
      .catch(() => {})
      .then(() => this.processMessage(message));
    pendingMessages.set(this.userId, pending);

    try {
      await pending;
    } finally {
      if (pendingMessages.get(this.userId) === pending) {
        pendingMessages.delete(this.userId);
      }
    }
  }

  private async getConversationId(): Promise<string> {
    const key = `conversationId-${this.userId}`;
    const conversationId = await keyv.get(key);
    if (conversationId) return conversationId;

    const conversation = await this.openai.conversations.create();
    await keyv.set(key, conversation.id);
    this.logger.info(
      { conversationId: conversation.id },
      "Created conversation",
    );

    return conversation.id;
  }

  private handleFunctionCall = async (
    toolCall: ResponseFunctionToolCall,
    cache: Map<string, Promise<string>>,
  ): Promise<ResponseInputItem.FunctionCallOutput> => {
    const key = getToolCacheKey(toolCall.name, toolCall.arguments);
    let output = cache.get(key);
    const cached = Boolean(output);
    this.logger.debug(
      {
        functionName: toolCall.name,
        functionArgs: toolCall.arguments,
        callId: toolCall.call_id,
        cached,
        type: "functionCall",
      },
      "Tool call",
    );
    if (!output) {
      output = executeTool(onTap, toolCall.name, toolCall.arguments)
        .then((result) => JSON.stringify(result))
        .catch((error: unknown) => {
          this.logger.error(
            { err: error, functionName: toolCall.name },
            "Tool failed",
          );
          return JSON.stringify({
            status: "tool_error",
            message:
              "Unable to retrieve data. Do not infer that the pub or beer is absent. Ask the user to retry.",
          });
        });
      cache.set(key, output);
    }

    this.logger.info(
      {
        functionName: toolCall.name,
        cached,
        type: "functionResult",
      },
      "Tool result ready",
    );
    return {
      type: "function_call_output",
      call_id: toolCall.call_id,
      output: await output,
    };
  };

  private async processMessage(message: string) {
    const conversation = await this.getConversationId();
    let input: ResponseInput = [{ role: "user", content: message }];
    let fullMsgText = "";
    const toolCache = new Map<string, Promise<string>>();
    let finalize = false;
    let toolRounds = 0;

    while (true) {
      const stream = await this.openai.responses.create({
        ...agentConfig,
        conversation,
        input,
        store: true,
        stream: true,
        tool_choice: finalize ? "none" : "auto",
      });
      const toolCalls: ResponseFunctionToolCall[] = [];
      let completed = false;

      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          fullMsgText += event.delta;
          this.emit("assistantMessage", {
            delta: event.delta,
            snapshot: { value: fullMsgText },
          });
        } else if (
          event.type === "response.output_item.added" &&
          event.item.type === "function_call"
        ) {
          this.emit(
            "assistantToolCreated",
            `Function call: ${event.item.name}`,
          );
        } else if (
          event.type === "response.output_item.done" &&
          event.item.type === "function_call"
        ) {
          toolCalls.push(event.item);
        } else if (event.type === "response.completed") {
          completed = true;
        } else if (
          event.type === "response.failed" ||
          event.type === "response.incomplete"
        ) {
          throw new Error(
            event.response.error?.message ||
              `Response ${event.response.status}`,
          );
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }

      if (!completed)
        throw new Error("Response stream ended before completion");

      if (toolCalls.length === 0) {
        this.emit("assistantMessageDone");
        this.emit("assistantMessageEnd");
        return;
      }

      if (finalize) throw new Error("Model exceeded the tool-call limit");
      const repeatedRound = toolCalls.every((call) =>
        toolCache.has(getToolCacheKey(call.name, call.arguments)),
      );
      input = await Promise.all(
        toolCalls.map((call) => this.handleFunctionCall(call, toolCache)),
      );
      toolRounds++;
      finalize = repeatedRound || toolRounds >= 6;
    }
  }
}
