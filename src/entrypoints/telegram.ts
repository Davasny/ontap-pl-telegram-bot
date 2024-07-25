import { Bot } from "grammy";
import { Agent } from "../agent/Agent";
import { debounce } from "../utils/debounce";
import { logger } from "../logger";
import { WELCOME_MESSAGE } from "../consts";
import { IUserMessagePayload } from "../types/events";

const main = async () => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error("TELEGRAM_BOT_TOKEN env variable not set");
    process.exit(1);
  }

  const bot = new Bot(botToken);

  bot.command("start", async (ctx) => {
    await ctx.reply(WELCOME_MESSAGE);
  });

  bot.command("md", async (ctx) => {
    const chatId = ctx.msg.chat.id;

    await bot.api.sendMessage(
      chatId,
      "[ontap](https://ontap.pl) _under_ *bold*",
      {
        parse_mode: "Markdown",
      },
    );
  });

  bot.on("message", async (ctx) => {
    const chatId = ctx.msg.chat.id;
    const userId = ctx.update.message.from.id.toString();
    const username = ctx.update.message.from.username;

    const msgId = ctx.update.message.message_id;
    const traceId = `${chatId}:${userId}:${username}:${msgId}`;
    const childLogger = logger.child({
      trace_id: traceId,
      userId,
      username,
      chatId,
      messageId: msgId,
    });

    const agent = new Agent(userId, childLogger);

    const msg = ctx.update.message.text;
    if (!msg) {
      await bot.api.sendMessage(
        chatId,
        "Wybacz, coś się popsuło i nie rozumiem Twojej wiadomości.",
      );
      return;
    }

    const pendingMessageText = "👀";
    const message = await bot.api.sendMessage(chatId, pendingMessageText, {
      parse_mode: "Markdown",
    });

    const debouncedEditMessageText = debounce(
      async (chatId: number, messageId: number, snapshot: string) => {
        await bot.api.editMessageText(chatId, messageId, snapshot);
      },
      50,
    );

    let lassMessage = "";
    agent.on("assistantMessage", async ({ snapshot }) => {
      const newMessage = snapshot.value;
      if (lassMessage !== newMessage) {
        lassMessage = snapshot;
        await debouncedEditMessageText(chatId, message.message_id, newMessage);
      }
    });

    const payload: IUserMessagePayload = {
      message: msg,
    };

    agent.emit("userMessage", payload);
  });

  logger.info("Starting bot");
  await bot.start();
};

main();
