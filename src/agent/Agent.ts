import OpenAI from "openai";
import { OnTapService } from "../onTap/OnTapService";
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
import type Pino from "pino";
import { IUserMessagePayload } from "../types/events";
import { getSimplifiedBeersList } from "../onTap/getSimplifiedBeersList";

const onTap = OnTapService.getInstance();

const persistentDataPath = process.env.PERSISTENT_DATA_PATH || ".";
const keyv = new Keyv(`sqlite://${persistentDataPath}/db.sqlite`);

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

    this.on("userMessage", (payload: IUserMessagePayload) =>
      this.processMessage(payload.message),
    );
  }

  private async getThreadId(userId: string): Promise<string> {
    let threadId = await keyv.get(`threadId-${userId}`);
    if (!threadId) {
      threadId = await this.openai.beta.threads
        .create()
        .then((thread) => thread.id);

      await keyv.set(`threadId-${userId}`, threadId);

      this.logger.info({
        msg: `system: created new thread ${threadId}`,
        threadId,
      });
    }

    return threadId;
  }

  private async getAssistantId(): Promise<string> {
    const assistantVersion = generateHash(JSON.stringify(assistantConfig));

    let assistantId = await keyv.get(`assistantId-${assistantVersion}`);

    await this.openai.beta.assistants.retrieve(assistantId).catch(async () => {
      this.logger.info({
        msg: "Assistant not found, deleting from kv and creating new one",
      });

      await keyv.delete(`assistantId-${assistantVersion}`);
      assistantId = undefined;
    });

    if (!assistantId) {
      this.logger.info({
        msg: `system: Creating new assistant`,
        assistantVersion,
      });

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

    this.logger.info({
      msg: `assistant: functionCall ${functionName}`,
      functionName,
      functionArgs,
      type: "functionCall",
    });

    let functionResult: string | string[] = `Unknown function ${functionName}`;

    try {
      if (functionName === "getCitiesNames") {
        functionResult = await onTap.getCitiesNames();
      }

      if (functionName === "getPubsInCity") {
        const args = JSON.parse(functionArgs) as {
          cityName: string;
        };

        functionResult = await onTap.getPubsInCity(args.cityName);
      }

      if (functionName === "getPubDetails") {
        const args = JSON.parse(functionArgs) as {
          cityName: string;
          pubName: string;
        };

        const functionResultObject = await onTap.getPubDetails(
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

        functionResult = await onTap.getGoogleMapsUrl(
          args.cityName,
          args.pubName,
        );
      }

      if (functionName === "getBeers") {
        const args = JSON.parse(functionArgs) as BeersFilters;
        const fullResult = await onTap.getBeers(args);
        functionResult = getSimplifiedBeersList(fullResult);
      }
    } catch (e) {
      functionResult = `Exception occurred: ${e}`;
      if (e instanceof Error) {
        functionResult = `Exception occurred: ${e.message}`;
      }
    }

    this.logger.info({
      msg: `system: functionResult ${functionName}`,
      functionName,
      functionArgs,
      functionResult,
      type: "functionResult",
    });

    return {
      tool_call_id: toolCall.id,
      output: Array.isArray(functionResult)
        ? functionResult.join(", ")
        : functionResult,
    };
  };

  private observeStream(oaiStream: AssistantStream, threadId: string) {
    let fullMsgText = "";
    let start = Date.now();

    oaiStream.on("textDelta", (delta, snapshot) => {
      fullMsgText += delta.value;
      this.emit("assistantMessage", { delta: delta.value, snapshot });
    });

    oaiStream.on("textDone", () => {
      this.logger.info({
        msg: `assistant: ${fullMsgText.slice(0, 100)}`,
        response: fullMsgText,
        duration: Date.now() - start,
        type: "textDone",
      });
    });

    oaiStream.on("toolCallCreated", (e) => {
      if (e.type === "function") {
        const funcName = e.function.name;

        this.logger.info({
          msg: `assistant: toolCallCreated ${funcName}`,
          function: funcName,
          type: "toolCallCreated",
        });

        this.emit("assistantToolCreated", `Function call: ${funcName}`);
      }
    });

    oaiStream.on("messageDone", () => {
      this.logger.info({ msg: "assistant: messageDone", type: "messageDone" });
      this.emit("assistantMessageDone");
    });

    oaiStream.on("end", async () => {
      // check if there are any tool calls to respond to
      const currentRun = oaiStream.currentRun();
      if (
        !currentRun ||
        currentRun.status !== "requires_action" ||
        !currentRun.required_action
      ) {
        this.logger.info({
          msg: `system: streamEnd`,
          status: currentRun?.status,
          type: "streamEnd",
        });
        return;
      }

      const tool_outputs = await Promise.all(
        currentRun.required_action?.submit_tool_outputs?.tool_calls?.map((t) =>
          this.handleFunctionCall(t),
        ),
      );

      this.logger.info({
        msg: "system: submitToolOutputs",
        tool_outputs: JSON.stringify(tool_outputs),
        type: "submitToolOutputs",
      });

      const newStream = this.openai.beta.threads.runs.submitToolOutputsStream(
        threadId,
        currentRun.id,
        { tool_outputs },
      );

      this.observeStream(newStream, threadId);
    });
  }

  private async processMessage(message: string) {
    const assistantId = await this.getAssistantId();
    const threadId = await this.getThreadId(this.userId);

    const activeRuns = await this.openai.beta.threads.runs.list(threadId);
    for await (const run of activeRuns) {
      if (run.status === "in_progress" || run.status === "requires_action") {
        this.logger.warn({
          msg: `system: Cancelling orphaned run: ${run.id}`,
          type: "cancelRun",
        });
        await this.openai.beta.threads.runs.cancel(threadId, run.id);
      }
    }

    this.logger.info({
      msg: `user: ${message}`,
      content: message,
      type: "newMessage",
    });

    await this.openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    });

    const oaiStream = this.openai.beta.threads.runs.stream(threadId, {
      assistant_id: assistantId,
    });

    this.observeStream(oaiStream, threadId);
  }
}
