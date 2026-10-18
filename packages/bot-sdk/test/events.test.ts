import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bot } from "../src/bot.js";
import type { BotIdentity } from "../src/config.js";
import { Message } from "../src/message.js";
import type { ReactionEvent } from "../src/types.js";
import { FakeAulora } from "./fakeServer.js";
import { event, message, pause, waitFor } from "./helpers.js";

function makeBot(fake: FakeAulora, includeSelf = false): Bot {
  return new Bot({
    token: "abt_test",
    siteUrl: fake.url,
    convexUrl: fake.url,
    pollIntervalMs: 10,
    includeSelf,
  });
}

describe("event polling", () => {
  let fake: FakeAulora;

  beforeEach(async () => {
    fake = new FakeAulora();
    await fake.start();
  });

  afterEach(async () => {
    await fake.close();
  });

  it("dispatches every event type with typed payloads", async () => {
    fake.pollQueue.push({
      events: [
        event("message.created", { seq: 1, message: message({ body: "hello" }) }),
        event("message.updated", {
          seq: 2,
          message: message({ body: "edited", editedAt: 123 }),
        }),
        event("message.deleted", {
          seq: 3,
          message: message({ body: "", deletedAt: 456 }),
        }),
        event("reaction.added", {
          seq: 4,
          reaction: { messageId: "msg_1", userId: "user_2", emoji: "👍" },
        }),
        event("reaction.removed", {
          seq: 5,
          reaction: { messageId: "msg_1", userId: "user_2", emoji: "👍" },
        }),
      ],
      cursor: 500,
      me: { userId: "bot_1", name: "Test Bot" },
    });
    const bot = makeBot(fake);
    const ready: BotIdentity[] = [];
    const created: Message[] = [];
    const updated: Message[] = [];
    const deleted: Message[] = [];
    const added: ReactionEvent[] = [];
    const removed: ReactionEvent[] = [];
    bot.on("ready", (identity) => {
      ready.push(identity);
    });
    bot.on("message", (entry) => {
      created.push(entry);
    });
    bot.on("messageUpdate", (entry) => {
      updated.push(entry);
    });
    bot.on("messageDelete", (entry) => {
      deleted.push(entry);
    });
    bot.on("reactionAdd", (reaction) => {
      added.push(reaction);
    });
    bot.on("reactionRemove", (reaction) => {
      removed.push(reaction);
    });

    const started = bot.start();
    await waitFor(() => removed.length === 1 && ready.length === 1, 2000, "all events");
    await bot.stop();
    await started;

    expect(ready[0]).toEqual({ userId: "bot_1", name: "Test Bot" });
    expect(created[0]?.body).toBe("hello");
    expect(created[0]).toBeInstanceOf(Message);
    expect(updated[0]?.body).toBe("edited");
    expect(updated[0]?.editedAt).toBe(123);
    expect(deleted[0]?.body).toBe("");
    expect(deleted[0]?.deletedAt).toBe(456);
    expect(added[0]).toEqual({
      messageId: "msg_1",
      channelId: "chan_1",
      userId: "user_2",
      emoji: "👍",
      self: false,
    });
    expect(removed[0]?.emoji).toBe("👍");
  });

  it("skips the bot's own events by default and delivers them with includeSelf", async () => {
    fake.pollQueue.push({
      events: [event("message.created", { self: true, message: message({ body: "mine" }) })],
      cursor: 1,
      me: { userId: "bot_1", name: "Test Bot" },
    });
    const bot = makeBot(fake);
    const received: Message[] = [];
    bot.on("message", (entry) => {
      received.push(entry);
    });

    const started = bot.start();
    await waitFor(() => bot.me !== null, 2000, "identity");
    await pause(60);
    await bot.stop();
    await started;

    expect(received).toHaveLength(0);
  });

  it("delivers self events when includeSelf is true", async () => {
    fake.pollQueue.push({
      events: [event("message.created", { self: true, message: message({ body: "mine" }) })],
      cursor: 1,
      me: { userId: "bot_1", name: "Test Bot" },
    });
    const bot = makeBot(fake, true);
    const received: Message[] = [];
    bot.on("message", (entry) => {
      received.push(entry);
    });

    const started = bot.start();
    await waitFor(() => received.length === 1, 2000, "self message");
    await bot.stop();
    await started;

    expect(received[0]?.body).toBe("mine");
  });

  it("passes the previous cursor back to botEvents:poll", async () => {
    fake.pollQueue.push(
      { events: [], cursor: 10, me: { userId: "bot_1", name: "Test Bot" } },
      { events: [], cursor: 11, me: { userId: "bot_1", name: "Test Bot" } },
      { events: [], cursor: 12, me: { userId: "bot_1", name: "Test Bot" } },
    );
    const bot = makeBot(fake);

    const started = bot.start();
    await waitFor(() => fake.pollCalls().length >= 4, 2000, "four polls");
    await bot.stop();
    await started;

    const cursors = fake
      .pollCalls()
      .slice(0, 4)
      .map((call) => call.args.cursor);
    expect(cursors).toEqual([null, 10, 11, 12]);
    expect(fake.pollCalls()[0]?.args.limit).toBe(100);
  });

  it("routes sync throws and async rejections from handlers to error", async () => {
    fake.pollQueue.push({
      events: [event("message.created")],
      cursor: 1,
      me: { userId: "bot_1", name: "Test Bot" },
    });
    const bot = makeBot(fake);
    const errors: Error[] = [];
    bot.on("error", (error) => {
      errors.push(error);
    });
    bot.on("message", () => {
      throw new Error("sync boom");
    });
    bot.on("message", async () => {
      await Promise.resolve();
      throw new Error("async boom");
    });

    const started = bot.start();
    await waitFor(() => errors.length === 2, 2000, "both handler errors");
    await bot.stop();
    await started;

    expect(errors.map((error) => error.message).sort()).toEqual(["async boom", "sync boom"]);
  });

  it("stops the poll loop without leaking timers and resolves start()", async () => {
    const bot = makeBot(fake);
    const started = bot.start();
    await waitFor(() => fake.pollCalls().length >= 1, 2000, "first poll");
    await bot.stop();
    await started;
    const pollsAfterStop = fake.pollCalls().length;

    await pause(80);

    expect(fake.pollCalls().length).toBe(pollsAfterStop);
  });

  it("installs SIGTERM/SIGINT handlers and stops when they fire", async () => {
    const termListeners = process.listeners("SIGTERM");
    const intListeners = process.listeners("SIGINT");
    const bot = makeBot(fake);
    const started = bot.start();
    await waitFor(() => fake.pollCalls().length >= 1, 2000, "first poll");

    expect(process.listenerCount("SIGTERM")).toBe(termListeners.length + 1);
    expect(process.listenerCount("SIGINT")).toBe(intListeners.length + 1);
    const added = process
      .listeners("SIGTERM")
      .filter((listener) => !termListeners.includes(listener));
    const trigger = added.at(-1);
    expect(trigger).toBeDefined();
    (trigger as () => void)();

    await started;
    expect(process.listenerCount("SIGTERM")).toBe(termListeners.length);
    expect(process.listenerCount("SIGINT")).toBe(intListeners.length);
  });

  it("does not install signal handlers when handleSignals is false", async () => {
    const before = process.listenerCount("SIGTERM");
    const bot = new Bot({
      token: "abt_test",
      siteUrl: fake.url,
      convexUrl: fake.url,
      pollIntervalMs: 10,
      handleSignals: false,
    });
    const started = bot.start();
    await waitFor(() => fake.pollCalls().length >= 1, 2000, "first poll");

    expect(process.listenerCount("SIGTERM")).toBe(before);
    await bot.stop();
    await started;
  });
});
