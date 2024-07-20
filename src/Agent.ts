import OpenAI from "openai";
import { OnTapService } from "./OnTapService";
import Keyv from "keyv";
import { BeersFilters } from "./types/types";
import {
  RequiredActionFunctionToolCall,
  RunSubmitToolOutputsParams,
} from "openai/src/resources/beta/threads/runs/runs";
import { AssistantCreateParams } from "openai/resources/beta";
import { generateHash } from "./utils/generateHash";
import "dotenv/config";

const repo = OnTapService.getInstance();
const keyv = new Keyv("sqlite://./db.sqlite");

const assistantConfig: AssistantCreateParams = {
  name: "Ontap Assistant",
  model: "gpt-4o-mini",
  instructions: `
You are an assistant helping users find information about pubs and beers in city.
Your goal is to meet the following requirements:
- always ask about user's city
- you cannot use knowledge other than provided by the system
- never use markdown
- translate text into Polish
- if you don't know something, tell the user
- list elements separated by commas
- never ask user if they need more help
- when describing beers, provide only alcohol percentage without "alkohol" word, and price in "zł"
- when using functions, provide correct full name of city
- never pass phone numbers
`,
  tools: [
    {
      type: "function",
      function: {
        name: "getCitiesNames",
        parameters: {
          type: "object",
          properties: {},
        },
        description: "List known cities",
      },
    },
    {
      type: "function",
      function: {
        name: "getPubsInCity",
        description: "List available pubs in city",
        parameters: {
          type: "object",
          properties: {
            cityName: {
              type: "string",
              description: "Name of the city",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getPubDetails",
        description: "Get details about pub",
        parameters: {
          type: "object",
          properties: {
            cityName: {
              type: "string",
              description: "Name of the city",
            },
            pubName: {
              type: "string",
              description: "Name of the pub",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getGoogleMapsUrl",
        description: "Get google maps url for pub",
        parameters: {
          type: "object",
          properties: {
            cityName: {
              type: "string",
              description: "Name of the city",
            },
            pubName: {
              type: "string",
              description: "Name of the pub",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getBeers",
        description: "Get beers available in city using filters",
        parameters: {
          type: "object",
          properties: {
            cityName: {
              type: "string",
              description: "Name of the city",
            },
            limitBeers: {
              type: "number",
              description: "Limit returned beers",
            },
            lowerCaseStyleRegex: {
              type: "string",
              description: "lowercase written regex for matching beer style",
            },
            lowerCaseBeerNameRegex: {
              type: "string",
              description: "lowercase written regex for matching beer name",
            },
            priceFrom: {
              type: "number",
              description: "Price from in PLN",
            },
            priceTo: {
              type: "number",
              description: "Price to in PLN",
            },
            abvFrom: {
              type: "number",
              description: "Alcohol abv from in %",
            },
            abvTo: {
              type: "number",
              description: "Alcohol abv to in %",
            },
            pubNameRegex: {
              type: "string",
              description: "lowercase written regex for matching pub name",
            },
          },
          required: ["cityName", "limitBeers"],
        },
      },
    },
  ],
};

export class Agent {
  private openai: OpenAI;
  private userId: string;

  constructor(userId: string) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    this.userId = userId;
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
    console.log(
      "[CB]",
      toolCall.function.name,
      "args:",
      toolCall.function.arguments,
    );

    let functionResult: string | string[] =
      `Unknown function ${toolCall.function.name}`;

    try {
      if (toolCall.function.name === "getCitiesNames") {
        functionResult = await repo.getCitiesNames();
      }

      if (toolCall.function.name === "getPubsInCity") {
        const args = JSON.parse(toolCall.function.arguments) as {
          cityName: string;
        };

        functionResult = await repo.getPubsInCity(args.cityName);
      }

      if (toolCall.function.name === "getPubDetails") {
        const args = JSON.parse(toolCall.function.arguments) as {
          cityName: string;
          pubName: string;
        };

        const functionResultObject = await repo.getPubDetails(
          args.cityName,
          args.pubName,
        );
        functionResult = JSON.stringify(functionResultObject);
      }

      if (toolCall.function.name === "getGoogleMapsUrl") {
        const args = JSON.parse(toolCall.function.arguments) as {
          cityName: string;
          pubName: string;
        };

        functionResult = await repo.getGoogleMapsUrl(
          args.cityName,
          args.pubName,
        );
      }

      if (toolCall.function.name === "getBeers") {
        const args = JSON.parse(toolCall.function.arguments) as BeersFilters;
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

  public async processMessage(message: string): Promise<string> {
    const threadId = await this.getThreadId();
    const assistantId = await this.getAssistantId();

    const activeRuns = await this.openai.beta.threads.runs.list(threadId);
    for await (const run of activeRuns) {
      if (run.status === "in_progress" || run.status === "requires_action") {
        console.log("[CB] Cancelling run:", run.id);
        await this.openai.beta.threads.runs.cancel(threadId, run.id);
      }
    }

    await this.openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    });

    let run = await this.openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    });

    console.log("[CB] run status:", run.status);

    await new Promise<void>((resolve) => {
      // todo: add timeout
      // todo: handle other statuses

      const intervalId = setInterval(async () => {
        run = await this.openai.beta.threads.runs.retrieve(threadId, run.id);
        console.log("[CB] run status:", run.status);

        if (run.status === "completed") {
          clearInterval(intervalId);
          resolve();
        } else if (run.status === "requires_action") {
          const toolsCalls =
            run.required_action?.submit_tool_outputs.tool_calls;

          console.log(
            "[CB] Functions to call:",
            toolsCalls?.map((call) => call.function.name),
          );

          if (!toolsCalls) {
            throw new Error("No tool calls in status requires_action");
          }

          const promises: Promise<RunSubmitToolOutputsParams.ToolOutput>[] =
            toolsCalls.map(async (toolCall) =>
              this.handleFunctionCall(toolCall),
            );

          const toolOutputsPayload = await Promise.all(promises).then(
            (responses) => responses,
          );

          try {
            console.log("[CB] Submitting tool outputs", toolOutputsPayload);
            await this.openai.beta.threads.runs.submitToolOutputs(
              threadId,
              run.id,
              {
                tool_outputs: toolOutputsPayload,
              },
            );
          } catch (e) {
            console.log(e);
          }
        }
      }, 1000);
    });

    const messages = await this.openai.beta.threads.messages.list(threadId, {
      limit: 1,
    });

    const response = messages.data[0].content[0];
    let assistantMessage =
      response.type === "text"
        ? response.text.value
        : `unknown response type - ${response.type}`;

    console.log("[CB] response:");
    console.log(assistantMessage);

    return assistantMessage;
  }
}
