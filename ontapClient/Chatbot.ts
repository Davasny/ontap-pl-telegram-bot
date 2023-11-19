import OpenAI from "openai";
import { Repository } from "./Repository";
import * as console from "console";
import Keyv from "keyv";
import * as process from "process";
import { BeersFilters } from "./types";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const repo = new Repository();
const keyv = new Keyv("sqlite://./db.sqlite");

const userId = "user_25";

const MODEL = {
  m3: "gpt-3.5-turbo-1106",
  m4: "gpt-4-1106-preview",
};

async function main() {
  const assistant = await client.beta.assistants.create({
    name: "Ontap Assistant",
    model: MODEL.m4,
    instructions: `
Jesteś asystentem znającym dostępne puby i piwa w mieście.
Zawsze pytaj o miasto, które interesuje użytkownika.
Nie wolno ci odpowiedzieć na pytanie, jeśli nie znasz miasta. 
Twoim zadaniem jest udzielić informacji na temat piw na podstawie tylko i wyłącznie wiedzy dostarczonej 
przez system.
Nie wolno Ci polegać na wcześniej zdobytej wiedzy.
Jeśli nie masz wiedzy na jakiś temat, to poinformuj o tym użytkownika.
Nie wolno robić ci założeń, jeśli brakuje Ci informacji, spytaj użytkownika.
Listy elementów pisz po przecinku, a nie od nowych linii.
Zawsze używaj polskich znaków i polskich nazw miast.
W przypadku pytania o drogę, odeślij link do google maps.
Gdy opisujesz dostępne piwa, napisz tylko % alkoholu bez "ABV"
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
              priceFrom: {
                type: "number",
                description: "Price from in PLN",
              },
              priceTo: {
                type: "number",
                description: "Price to in PLN",
              },
              pubName: {
                type: "string",
                description: "Name of the pub",
              },
            },
            required: ["cityName", "limitBeers"],
          },
        },
      },
    ],
  });

  let threadId = await keyv.get(`threadId-${userId}`);
  if (!threadId) {
    threadId = await client.beta.threads.create().then((thread) => thread.id);
    await keyv.set(`threadId-${userId}`, threadId);
    console.log(`Created new thread ${threadId} for user ${userId}`);
  }

  await client.beta.threads.messages.create(threadId, {
    role: "user",
    content: "w krakowie",
  });

  let run = await client.beta.threads.runs.create(threadId, {
    assistant_id: assistant.id,
  });

  console.log(run.status);

  await new Promise<void>((resolve) => {
    // todo: add timeout
    // todo: handle other statuses

    const intervalId = setInterval(async () => {
      run = await client.beta.threads.runs.retrieve(threadId, run.id);
      console.log(run.status);

      if (run.status === "completed") {
        clearInterval(intervalId);
        resolve();
      } else if (run.status === "requires_action") {
        const toolsCalls = run.required_action?.submit_tool_outputs.tool_calls;

        console.log(
          "Functions to call:",
          toolsCalls?.map((call) => call.function.name),
        );

        if (!toolsCalls) {
          throw new Error("No tool calls in status requires_action");
        }

        const promises: Promise<{ tool_call_id: string; output: string }>[] =
          toolsCalls.map(async (toolCall) => {
            if (toolCall.function.name === "getCitiesNames") {
              const functionResult = await repo.getCitiesNames();
              return {
                tool_call_id: toolCall.id,
                output: functionResult.join(", "),
              };
            }

            if (toolCall.function.name === "getPubsInCity") {
              const args = JSON.parse(toolCall.function.arguments) as {
                cityName: string;
              };

              const functionResult = await repo.getPubsInCity(args.cityName);
              return {
                tool_call_id: toolCall.id,
                output: functionResult.join(", "),
              };
            }

            if (toolCall.function.name === "getPubDetails") {
              const args = JSON.parse(toolCall.function.arguments) as {
                cityName: string;
                pubName: string;
              };

              const functionResult = await repo.getPubDetails(
                args.cityName,
                args.pubName,
              );
              return {
                tool_call_id: toolCall.id,
                output: JSON.stringify(functionResult),
              };
            }

            if (toolCall.function.name === "getGoogleMapsUrl") {
              const args = JSON.parse(toolCall.function.arguments) as {
                cityName: string;
                pubName: string;
              };

              const functionResult = await repo.getGoogleMapsUrl(
                args.cityName,
                args.pubName,
              );
              return {
                tool_call_id: toolCall.id,
                output: functionResult,
              };
            }

            if (toolCall.function.name === "getBeers") {
              const args = JSON.parse(
                toolCall.function.arguments,
              ) as BeersFilters;

              console.log("getBeers args", args);

              const functionResult = await repo.getBeers(args);
              return {
                tool_call_id: toolCall.id,
                output: JSON.stringify(functionResult),
              };
            }

            throw new Error(`Unknown function ${toolCall.function.name}`);
          });

        const toolOutputsPayload = await Promise.all(promises).then(
          (responses) => responses,
        );

        try {
          await client.beta.threads.runs.submitToolOutputs(threadId, run.id, {
            tool_outputs: toolOutputsPayload,
          });
        } catch (e) {
          console.log(e);
        }
      }
    }, 500);
  });

  const messages = await client.beta.threads.messages.list(threadId, {
    limit: 1,
  });

  const response = messages.data[0].content[0];
  let assistantMessage =
    response.type === "text"
      ? response.text.value
      : `unknown response type - ${response.type}`;

  console.log(assistantMessage);
}

main();
