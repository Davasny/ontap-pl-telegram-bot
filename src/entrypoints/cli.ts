import { User } from "../User";

import * as readline from "readline";

const main = async () => {
  const userId = "user_1";
  const user = new User(userId);

  console.log("Witaj w Ontap bot cli. Wpisz exit aby wyjść.");
  console.log("O co chcesz zapytać?");

  const rl = readline.createInterface({
    input: process.stdin,
  });

  for await (const line of rl) {
    if (line.toLowerCase() === "exit") {
      rl.close();
      break;
    }

    try {
      await user.processMessage(line);
    } catch (error) {
      console.error(`Error processing message: ${error}`);
    }
  }
};

main();
