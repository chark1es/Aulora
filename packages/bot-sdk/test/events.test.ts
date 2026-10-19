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

/** Queues one poll result carrying every event type the SDK dispatches. */
function pushEveryEventType(fake: FakeAulora): void {
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
}

type CollectedEvents = {
  readonly ready: BotIdentity[];
  readonly created: Message[];
  readonly updated: Message[];
  readonly deleted: Message[];
  readonly added: ReactionEvent[];
  readonly removed: ReactionEvent[];
};

/** Records each event type in its own array so a test can assert per-type payloads. */
function collectEvents(bot: Bot): CollectedEvents {
  const collected: CollectedEvents = {
    ready: [],
    created: [],
    updated: [],
    deleted: [],
    added: [],
    removed: [],
  };
  bot.on("ready", (identity) => {
    collected.ready.push(identity);
  });
  bot.on("message", (entry) => {
    collected.created.push(entry);
  });
  bot.on("messageUpdate", (entry) => {
    collected.updated.push(entry);
  });
  bot.on("messageDelete", (entry) => {
    collected.deleted.push(entry);
  });
  bot.on("reactionAdd", (reaction) => {
    collected.added.push(reaction);
  });
  bot.on("reactionRemove", (reaction) => {
    collected.removed.push(reaction);
  });
  return collected;
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
    pushEveryEventType(fake);
    const bot = makeBot(fake);
    const collected = collectEvents(bot);

    const started = bot.start();
    await waitFor(
      () => collected.removed.length === 1 && collected.ready.length === 1,
      2000,
      "all events",
    );
    await bot.stop();
    await started;

    expect(collected.ready[0]).toEqual({ userId: "bot_1", name: "Test Bot" });
    expect(collected.created[0]?.body).toBe("hello");
    expect(collected.created[0]).toBeInstanceOf(Message);
    expect(collected.updated[0]?.body).toBe("edited");
    expect(collected.updated[0]?.editedAt).toBe(123);
    expect(collected.deleted[0]?.body).toBe("");
    expect(collected.deleted[0]?.deletedAt).toBe(456);
    expect(collected.added[0]).toEqual({
      messageId: "msg_1",
      channelId: "chan_1",
      userId: "user_2",
      emoji: "👍",
      self: false,
    });
    expect(collected.removed[0]?.emoji).toBe("👍");
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
