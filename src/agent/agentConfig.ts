import { AssistantCreateParams } from "openai/resources/beta";

export const assistantConfig: AssistantCreateParams = {
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
