import { Bot } from "grammy";
import { Agent } from "../agent/Agent";
import { debounce } from "../utils/debounce";
import { logger } from "../logger";
import { WELCOME_MESSAGE } from "../consts";
import { IUserMessagePayload } from "../types/events";

interface IHandleMessageArgs {
  chatId: number;
  msgId: number;
  userId: number;
  username: string;
  message: string;
}

const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  console.error("TELEGRAM_BOT_TOKEN env variable not set");
  process.exit(1);
}

const bot = new Bot(botToken);

const handleMessage = async (props: IHandleMessageArgs) => {
  const chatId = props.chatId;
  const userId = props.userId;
  const username = props.username;
  const msgId = props.msgId;

  const traceId = `${chatId}:${userId}:${username}:${msgId}`;
  const childLogger = logger.child({
    trace_id: traceId,
    userId,
    username,
    chatId,
    messageId: msgId,
  });

  const agent = new Agent(userId.toString(), childLogger);

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
    message: props.message,
  };

  agent.emit("userMessage", payload);
};

const main = async () => {
  bot.command("start", async (ctx) => {
    const msgId = ctx.message?.message_id;

    if (!msgId) {
      await ctx.reply(WELCOME_MESSAGE);
      return;
    }

    const username = ctx.update.message?.from.username || "not provided";

    await handleMessage({
      chatId: ctx.chat.id,
      userId: ctx.from?.id || 0,
      username,
      msgId: msgId,
      message: `Cześć! Jestem nowym użytkownikiem o nicku ${username}. Powiedz mi o sobie`,
    });
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
    const msg = ctx.update.message.text;
    if (!msg) {
      await bot.api.sendMessage(
        ctx.chat.id,
        "Wybacz, coś się popsuło i nie rozumiem Twojej wiadomości.",
      );
      return;
    }

    await handleMessage({
      chatId: ctx.chat.id,
      userId: ctx.from.id,
      username: ctx.update.message.from.username || "not provided",
      msgId: ctx.message.message_id,
      message: msg,
    });
  });

  logger.info("system: starting bot");
  await bot.start();
};

main();
