import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bot } from "../src/bot.js";
import { Message } from "../src/message.js";
import { FakeAulora } from "./fakeServer.js";
import { message } from "./helpers.js";

function makeBot(fake: FakeAulora): Bot {
  return new Bot({
    token: "abt_test",
    siteUrl: fake.url,
    convexUrl: fake.url,
    handleSignals: false,
  });
}

function listOne(fake: FakeAulora, overrides: Parameters<typeof message>[0] = {}): void {
  fake.handlers.set("messages:list", () => ({
    page: [message(overrides)],
    isDone: true,
    continueCursor: "",
  }));
}

describe("message helpers", () => {
  let fake: FakeAulora;

  beforeEach(async () => {
    fake = new FakeAulora();
    await fake.start();
  });

  afterEach(async () => {
    await fake.close();
  });

  it("lists messages and exposes mentionsMe from the bot identity", async () => {
    listOne(fake, { mentionUserIds: ["bot_1"] });
    const bot = makeBot(fake);

    const messages = await bot.messages.list("chan_1", { limit: 10 });

    expect(fake.calls[0]?.args).toEqual({
      channelId: "chan_1",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(messages[0]).toBeInstanceOf(Message);
    expect(messages[0]?.mentionsMe).toBe(true);
    expect(messages[0]?.body).toBe("hello");
  });

  it("replies with messages:send and carries replyToId", async () => {
    listOne(fake);
    fake.handlers.set("messages:send", () => "msg_99");
    const bot = makeBot(fake);
    const [entry] = await bot.messages.list("chan_1");
    expect(entry).toBeDefined();

    const reply = await entry?.reply("pong");

    const send = fake.calls.find((call) => call.path === "messages:send");
    expect(send?.kind).toBe("mutation");
    expect(send?.args).toEqual({
      channelId: "chan_1",
      body: "pong",
      replyToId: "msg_1",
    });
    expect(reply?.id).toBe("msg_99");
    expect(reply?.body).toBe("pong");
  });

  it("keeps a thread reply inside its thread", async () => {
    listOne(fake, { id: "msg_2", threadRootId: "root_1" });
    fake.handlers.set("messages:send", () => "msg_100");
    const bot = makeBot(fake);
    const [entry] = await bot.messages.list("chan_1");
    expect(entry).toBeDefined();

    await entry?.reply("threaded");

    const send = fake.calls.find((call) => call.path === "messages:send");
    expect(send?.args).toEqual({
      channelId: "chan_1",
      body: "threaded",
      replyToId: "msg_2",
      threadRootId: "root_1",
    });
  });

  it("adds and removes reactions through reactions:toggle", async () => {
    listOne(fake);
    let addCalls = 0;
    fake.handlers.set("reactions:toggle", () => {
      addCalls += 1;
      return { added: addCalls > 1 };
    });
    const bot = makeBot(fake);
    const [entry] = await bot.messages.list("chan_1");
    expect(entry).toBeDefined();

    await entry?.react("👍");

    const addReactions = fake.calls.filter((call) => call.path === "reactions:toggle");
    expect(addReactions).toHaveLength(2);
    expect(addReactions.at(-1)?.args).toEqual({ messageId: "msg_1", emoji: "👍" });
    expect(addReactions.at(-1)?.kind).toBe("mutation");

    let removeCalls = 0;
    fake.handlers.set("reactions:toggle", () => {
      removeCalls += 1;
      return { added: removeCalls === 1 };
    });
    await bot.reactions.remove("msg_1", "👍");

    const removeReactions = fake.calls.filter((call) => call.path === "reactions:toggle");
    expect(removeReactions).toHaveLength(4);
    expect(removeReactions.at(-1)?.args).toEqual({ messageId: "msg_1", emoji: "👍" });
  });

  it("deletes and edits with the documented Convex paths", async () => {
    listOne(fake);
    const bot = makeBot(fake);
    const [entry] = await bot.messages.list("chan_1");
    expect(entry).toBeDefined();

    await entry?.edit("new body");
    await entry?.delete();

    const edit = fake.calls.find((call) => call.path === "messages:edit");
    const remove = fake.calls.find((call) => call.path === "messages:remove");
    expect(edit?.kind).toBe("mutation");
    expect(edit?.args).toEqual({ messageId: "msg_1", body: "new body" });
    expect(remove?.kind).toBe("mutation");
    expect(remove?.args).toEqual({ messageId: "msg_1" });
    expect(entry?.body).toBe("new body");
  });

  it("lists members and supports the action escape hatch", async () => {
    fake.handlers.set("members:list", () => [
      {
        id: "member_1",
        userId: "user_1",
        nickname: null,
        accountName: "Ada",
        roleIds: [],
        joinedAt: 1,
        timeoutUntil: null,
        avatarUrl: null,
        isBot: false,
      },
    ]);
    fake.handlers.set("custom:doThing", () => ({ ok: true }));
    const bot = makeBot(fake);

    const members = await bot.members.list();
    const result = await bot.call<{ ok: boolean }>("custom:doThing", { value: 1 }, "action");

    expect(members[0]?.accountName).toBe("Ada");
    expect(result).toEqual({ ok: true });
    const custom = fake.calls.find((call) => call.path === "custom:doThing");
    expect(custom?.kind).toBe("action");
    expect(custom?.args).toEqual({ value: 1 });
  });

  it("sends a message directly with reply and thread options", async () => {
    fake.handlers.set("messages:send", () => "msg_200");
    const bot = makeBot(fake);

    const sent = await bot.messages.send("chan_1", "hello", {
      replyToId: "msg_1",
      threadRootId: "root_1",
    });

    expect(sent.id).toBe("msg_200");
    expect(sent.authorId).toBe("bot_1");
    const send = fake.calls.find((call) => call.path === "messages:send");
    expect(send?.args).toEqual({
      channelId: "chan_1",
      body: "hello",
      replyToId: "msg_1",
      threadRootId: "root_1",
    });
  });
});
