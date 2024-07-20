import { Bot } from "grammy";
import { Agent } from "../agent/Agent";
import { debounce } from "../utils/debounce";

const main = async () => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    console.error("TELEGRAM_BOT_TOKEN env variable not set");
    process.exit(1);
  }

  const bot = new Bot(botToken);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Witaj! W czym mogę Ci pomóc? Czy interesuje Cię wyszukanie pubu lub konkretnego piwa w wybranym mieście? Proszę podać miasto i preferencje dotyczące piwa.",
    );
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
    const agent = new Agent(userId);

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

    agent.on("assistantMessage", async ({ snapshot }) => {
      await debouncedEditMessageText(
        chatId,
        message.message_id,
        snapshot.value,
      );
    });

    agent.emit("userMessage", msg);
  });

  console.log("Starting bot");
  await bot.start();
};

main();
