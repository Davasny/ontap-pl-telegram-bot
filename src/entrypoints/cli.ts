import * as readline from "readline";
import { Agent } from "../agent/Agent";

const main = async () => {
  const userId = "user_1";
  const agent = new Agent(userId);

  console.log("Witaj w Ontap bot cli. Wpisz exit aby wyjść.");
  console.log("O co chcesz zapytać?");

  const rl = readline.createInterface({
    input: process.stdin,
  });

  agent.on("assistantMessage", ({ delta }) => process.stdout.write(delta));
  agent.on("assistantMessageDone", () => process.stdout.write("-- done --\n"));
  agent.on("assistantMessageEnd", () => process.stdout.write("-- end --\n"));

  for await (const line of rl) {
    if (line.toLowerCase() === "exit") {
      rl.close();
      break;
    }

    try {
      agent.emit("userMessage", line);
    } catch (error) {
      console.error(`Error processing message: ${error}`);
    }
  }
};

main();
