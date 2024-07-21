import OpenAI from "openai";
import { OnTapService } from "../OnTapService";
import Keyv from "keyv";
import { BeersFilters } from "../types/types";
import {
  RequiredActionFunctionToolCall,
  RunSubmitToolOutputsParams,
} from "openai/src/resources/beta/threads/runs/runs";
import { generateHash } from "../utils/generateHash";
import "dotenv/config";
import { EventEmitter } from "events";
import { AssistantStream } from "openai/lib/AssistantStream";
import { assistantConfig } from "./agentConfig";

const repo = OnTapService.getInstance();

const persistentDataPath = process.env.PERSISTENT_DATA_PATH || ".";
const keyv = new Keyv(`sqlite://${persistentDataPath}/db.sqlite`);

export class Agent extends EventEmitter {
  private openai: OpenAI;
  private userId: string;

  constructor(userId: string) {
    super();

    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    this.userId = userId;

    this.on("userMessage", (message) => this.processMessage(message));
  }

  private async getThreadId(): Promise<string> {
    let threadId = await keyv.get(`threadId-${this.userId}`);
    if (!threadId) {
      threadId = await this.openai.beta.threads
        .create()
        .then((thread) => thread.id);
      await keyv.set(`threadId-${this.userId}`, threadId);
      console.log(`Created new thread ${threadId} for user ${this.userId}`);
    }

    return threadId;
  }

  private async getAssistantId(): Promise<string> {
    const assistantVersion = generateHash(JSON.stringify(assistantConfig));

    let assistantId = await keyv.get(`assistantId-${assistantVersion}`);

    await this.openai.beta.assistants.retrieve(assistantId).catch(async () => {
      console.log("Assistant not found, deleting from kv and creating new one");

      await keyv.delete(`assistantId-${assistantVersion}`);
      assistantId = undefined;
    });

    if (!assistantId) {
      console.log("Creating new assistant, config hash:", assistantVersion);

      const date = new Date();

      const assistant = await this.openai.beta.assistants.create({
        ...assistantConfig,
        name: `${
          assistantConfig.name
        } - ${date.toISOString()} - ${assistantVersion}`,
      });

      assistantId = assistant.id;
      await keyv.set(`assistantId-${assistantVersion}`, assistantId);
    }

    return assistantId;
  }

  private handleFunctionCall = async (
    toolCall: RequiredActionFunctionToolCall,
  ): Promise<RunSubmitToolOutputsParams.ToolOutput> => {
    if (!toolCall.function) {
      return {
        tool_call_id: toolCall.id,
        output: "Unknown function",
      };
    }

    const functionName = toolCall.function?.name;
    if (!functionName) {
      return {
        tool_call_id: toolCall.id,
        output: "Unknown function",
      };
    }

    const functionArgs = toolCall.function.arguments || "{}";

    console.log("[CB]", functionName, "args:", toolCall.function.arguments);

    let functionResult: string | string[] = `Unknown function ${functionName}`;

    try {
      if (functionName === "getCitiesNames") {
        functionResult = await repo.getCitiesNames();
      }

      if (functionName === "getPubsInCity") {
        const args = JSON.parse(functionArgs) as {
          cityName: string;
        };

        functionResult = await repo.getPubsInCity(args.cityName);
      }

      if (functionName === "getPubDetails") {
        const args = JSON.parse(functionArgs) as {
          cityName: string;
          pubName: string;
        };

        const functionResultObject = await repo.getPubDetails(
          args.cityName,
          args.pubName,
        );
        functionResult = JSON.stringify(functionResultObject);
      }

      if (functionName === "getGoogleMapsUrl") {
        const args = JSON.parse(functionArgs) as {
          cityName: string;
          pubName: string;
        };

        functionResult = await repo.getGoogleMapsUrl(
          args.cityName,
          args.pubName,
        );
      }

      if (functionName === "getBeers") {
        const args = JSON.parse(functionArgs) as BeersFilters;
        const fullResult = await repo.getBeers(args);
        functionResult = repo.simplifyGetBeersOutput(fullResult);
      }
    } catch (e) {
      functionResult = `Exception occurred: ${e}`;
      if (e instanceof Error) {
        functionResult = `Exception occurred: ${e.message}`;
      }
    }

    return {
      tool_call_id: toolCall.id,
      output: Array.isArray(functionResult)
        ? functionResult.join(", ")
        : functionResult,
    };
  };

  private observeStream(oaiStream: AssistantStream, threadId: string) {
    oaiStream.on("textDelta", (delta, snapshot) => {
      this.emit("assistantMessage", { delta: delta.value, snapshot });
    });

    oaiStream.on("toolCallCreated", (e) => {
      if (e.type === "function") {
        const funcName = e.function.name;
        this.emit("assistantToolCreated", `Function call: ${funcName}`);
      }
    });

    oaiStream.on("messageDone", () => this.emit("assistantMessageDone"));

    oaiStream.on("end", async () => {
      // check if there are any tool calls to respond to
      const currentRun = oaiStream.currentRun();
      if (!currentRun || currentRun.status !== "requires_action") return;
      if (!currentRun.required_action) return;

      const tool_outputs = await Promise.all(
        currentRun.required_action?.submit_tool_outputs?.tool_calls?.map((t) =>
          this.handleFunctionCall(t),
        ),
      );

      const newStream = this.openai.beta.threads.runs.submitToolOutputsStream(
        threadId,
        currentRun.id,
        { tool_outputs },
      );

      this.observeStream(newStream, threadId);
    });
  }

  public async processMessage(message: string) {
    const threadId = await this.getThreadId();
    const assistantId = await this.getAssistantId();

    const activeRuns = await this.openai.beta.threads.runs.list(threadId);
    for await (const run of activeRuns) {
      if (run.status === "in_progress" || run.status === "requires_action") {
        console.log("[CB] Cancelling orphaned run:", run.id);
        await this.openai.beta.threads.runs.cancel(threadId, run.id);
      }
    }

    await this.openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    });

    const oaiStream = this.openai.beta.threads.runs.stream(threadId, {
      assistant_id: assistantId,
    });

    this.observeStream(oaiStream, threadId);

    oaiStream.on("messageDone", () => this.emit("assistantMessageDone"));
  }
}
