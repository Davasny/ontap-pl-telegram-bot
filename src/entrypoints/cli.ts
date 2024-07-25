import * as readline from "readline";
import { Agent } from "../agent/Agent";
import { WELCOME_MESSAGE } from "../consts";
import { logger } from "../logger";
import { IUserMessagePayload } from "../types/events";

const main = async () => {
  const userId = "cli";
  const agent = new Agent(userId, logger);

  console.log(WELCOME_MESSAGE);

  const rl = readline.createInterface({
    input: process.stdin,
  });

  agent.on("assistantMessage", ({ delta }) => process.stdout.write(delta));
  agent.on("assistantMessageDone", () =>
    process.stdout.write("\n-- done --\n"),
  );
  agent.on("assistantMessageEnd", () => process.stdout.write("\n-- end --\n"));

  for await (const line of rl) {
    if (line.toLowerCase() === "exit") {
      rl.close();
      break;
    }

    try {
      const payload: IUserMessagePayload = {
        message: line,
      };

      agent.emit("userMessage", payload);
    } catch (error) {
      logger.error(`Error processing message: ${error}`);
    }
  }
};

main();
