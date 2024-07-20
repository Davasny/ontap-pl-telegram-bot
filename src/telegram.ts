import { Bot } from "grammy";
import { User } from "./User";
import * as console from "console";
import * as process from "process";

const main = async () => {
  const botToken = process.env.BOT_TOKEN;

  if (!botToken) {
    console.error("BOT_TOKEN env variable not set");
    process.exit(1);
  }

  const bot = new Bot(botToken);

  const users: Map<string, User> = new Map();

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Witaj! W czym mogę Ci pomóc? Czy interesuje Cię wyszukanie pubu lub konkretnego piwa w wybranym mieście? Proszę podać miasto i preferencje dotyczące piwa.",
    );
  });

  bot.command("md", async (ctx) => {
    const chatId = ctx.msg.chat.id;

    await bot.api.sendMessage(chatId, "[ontap](https://ontap.pl) _under_ *bold*", {
      parse_mode: "Markdown",
    });
  });

  bot.command("counter", async (ctx) => {
    const chatId = ctx.msg.chat.id;

    const msg = `ping`;

    const msgObj = await ctx.reply(msg, { parse_mode: "MarkdownV2" });

    let i = 5;

    let newMessage = `Odliczam ${i}`;
    await new Promise<void>((resolve) => {
      const interval = setInterval(async () => {
        i--;
        newMessage = `${newMessage}, ${i}`;
        console.log(newMessage);

        await bot.api.editMessageText(chatId, msgObj.message_id, newMessage);

        if (i <= 0) {
          clearInterval(interval);
          resolve();
        }
      }, 500);
    });

    newMessage = `${newMessage}. Gotowe!`;
    await bot.api.editMessageText(chatId, msgObj.message_id, newMessage);
  });

  bot.on("message", async (ctx) => {
    const chatId = ctx.msg.chat.id;

    const userId = ctx.update.message.from.id.toString();

    let user = users.get(userId);
    if (!user) {
      user = new User(userId);
      users.set(userId, user);
    }

    const msg = ctx.update.message.text;
    if (!msg) {
      await bot.api.sendMessage(
        chatId,
        "Wybacz, coś się popsuło i nie rozumiem Twojej wiadomości.",
      );
      return;
    }

    const pendingMessageText = "Myślę";
    const message = await bot.api.sendMessage(chatId, pendingMessageText, {
      parse_mode: "Markdown",
    });

    await new Promise<void>((resolve) => {
      let i = 0;
      const interval = setInterval(async () => {
        i++;
        let newMessage = `${pendingMessageText}`;
        for (let j = 0; j < i; j++) {
          newMessage = `${newMessage}.`;
        }

        if (i === 3) {
          i = 0;
        }

        await bot.api.editMessageText(chatId, message.message_id, newMessage);
      }, 1000);

      user?.processMessage(msg).then(async (response) => {
        clearInterval(interval);
        await bot.api.editMessageText(chatId, message.message_id, response, {
          parse_mode: "Markdown",
        });
        resolve();
      });
    });

    return;
  });

  console.log("Starting bot");
  bot.start();
};

main();
