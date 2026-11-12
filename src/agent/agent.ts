import OpenAI from "openai";
import { OntapService } from "../onTap/ontap-service";
import Keyv from "keyv";
import { BeerFilterResultSortBy, BeersFilters } from "../types/types";
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

import { formatBeersToCsv } from "./format-beers-to-csv";

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
  ): Promise<ResponseInputItem.FunctionCallOutput> => {
    const functionName = toolCall.name;
    const functionArgs = toolCall.arguments || "{}";

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

      if (functionName === "getPubNamesInCity") {
        const args = JSON.parse(functionArgs) as {
          cityName: string;
        };

        functionResult = await onTap.getPubNamesInCity(args.cityName);
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
        const args = JSON.parse(functionArgs) as {
          filter: BeersFilters;
          sortBy: BeerFilterResultSortBy;
          cityName: string;
          limitBeers: number;
        };

        const beersObject = await onTap.getBeers(
          {
            ...args.filter,
            cityName: args.cityName,
            limitBeers: args.limitBeers,
          },
          args.sortBy,
        );
        functionResult = formatBeersToCsv(beersObject.beers);
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
      type: "function_call_output",
      call_id: toolCall.call_id,
      output: Array.isArray(functionResult)
        ? functionResult.join(", ")
        : functionResult,
    };
  };

  private async processMessage(message: string) {
    const conversation = await this.getConversationId();
    let input: ResponseInput = [{ role: "user", content: message }];
    let fullMsgText = "";

    while (true) {
      const stream = await this.openai.responses.create({
        ...agentConfig,
        conversation,
        input,
        store: true,
        stream: true,
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

      input = await Promise.all(toolCalls.map(this.handleFunctionCall));
    }
  }
}
