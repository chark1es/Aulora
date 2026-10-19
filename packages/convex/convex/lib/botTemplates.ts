import { BOT_ENTRY_FILES, type BotLanguage } from "@aulora/core";

/**
 * Starter source written into a new bot. `hello` answers `!ping` with `pong`
 * and reacts to mentions; `blank` is a minimal connected skeleton. Both use the
 * documented SDK surface (`@aulora/bot` / `aulora_bot`).
 */

export type BotTemplateName = "hello" | "blank";

export interface BotTemplateFile {
  readonly path: string;
  readonly content: string;
}

const TS_HELLO = `import { Bot } from "@aulora/bot";

const bot = new Bot();

bot.on("message", async (message) => {
  if (message.mentionsMe) {
    await message.react("\u{1F44B}");
  }
  if (message.body.trim() === "!ping") {
    await message.reply("pong");
  }
});

bot.start();
`;

const TS_BLANK = `import { Bot } from "@aulora/bot";

const bot = new Bot();

bot.on("ready", () => {
  // Connected. Add handlers here, for example bot.on("message", ...).
});

bot.start();
`;

const PY_HELLO = `from aulora_bot import Bot

bot = Bot()


async def on_message(message):
    if message.mentions_me:
        await message.react("\u{1F44B}")
    if message.body.strip() == "!ping":
        await message.reply("pong")


bot.on("message", on_message)
bot.run()
`;

const PY_BLANK = `from aulora_bot import Bot

bot = Bot()


async def on_ready():
    # Connected. Add handlers here, for example bot.on("message", ...).
    pass


bot.on("ready", on_ready)
bot.run()
`;

const TEMPLATES: Readonly<Record<BotLanguage, Readonly<Record<BotTemplateName, string>>>> = {
  typescript: { hello: TS_HELLO, blank: TS_BLANK },
  python: { hello: PY_HELLO, blank: PY_BLANK },
};

/** The starter files for a new bot: one entry file, sealed by the caller. */
export function starterFiles(
  language: BotLanguage,
  template: BotTemplateName,
): readonly BotTemplateFile[] {
  return [{ path: BOT_ENTRY_FILES[language], content: TEMPLATES[language][template] }];
}
