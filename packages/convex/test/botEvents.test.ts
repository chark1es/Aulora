import { Permission } from "@aulora/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { Test } from "./helpers";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

interface BotSeed {
  readonly name?: string;
  readonly enabled?: boolean;
  readonly grants?: bigint;
  readonly allowedChannelIds?: readonly Id<"channels">[];
}

async function seedBot(
  t: Test,
  seed: BotSeed = {},
): Promise<{ botId: Id<"bots">; userId: string }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const name = seed.name ?? "listener";
    const botId = await ctx.db.insert("bots", {
      userId: "pending",
      name,
      language: "typescript",
      enabled: seed.enabled ?? true,
      grants: seed.grants ?? 0n,
      createdBy: "owner-1",
      createdAt: now,
      revision: 1,
      restartNonce: 0,
      status: "stopped",
      statusAt: now,
      ...(seed.allowedChannelIds !== undefined
        ? { allowedChannelIds: [...seed.allowedChannelIds] }
        : {}),
    });
    const userId = `bot_${botId}`;
    await ctx.db.patch(botId, { userId });
    await ctx.db.insert("members", { userId, nickname: name, roleIds: [], joinedAt: now });
    return { botId, userId };
  });
}

const READ_GRANTS = Permission.ViewChannel | Permission.ReadHistory;

interface Setup {
  readonly t: Test;
  readonly channelId: Id<"channels">;
  readonly botUserId: string;
  readonly asBot: ReturnType<Test["withIdentity"]>;
  readonly asUser: ReturnType<Test["withIdentity"]>;
}

async function setup(seed: BotSeed = {}): Promise<Setup> {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "user-1" }] });
  const channelId = await seedChannel(t);
  const { userId } = await seedBot(t, { grants: READ_GRANTS, ...seed });
  return {
    t,
    channelId,
    botUserId: userId,
    asBot: t.withIdentity({ subject: userId }),
    asUser: t.withIdentity({ subject: "user-1" }),
  };
}

/** The documented first call: no events, a cursor at "now". */
async function nowCursor(asBot: Setup["asBot"]): Promise<number> {
  const result = await asBot.query(api.botEvents.poll, { cursor: null });
  expect(result.events).toEqual([]);
  return result.cursor;
}

describe("botEvents.poll", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects callers that are not an enabled bot", async () => {
    const { t, asUser } = await setup();
    await expect(asUser.query(api.botEvents.poll, { cursor: null })).rejects.toThrow("Not a bot");
    await expect(t.query(api.botEvents.poll, { cursor: null })).rejects.toThrow();
    await expect(
      t.withIdentity({ subject: "bot_missing" }).query(api.botEvents.poll, { cursor: null }),
    ).rejects.toThrow("Not a bot");
  });

  it("starts at now: no replay, then reports a new message with its body", async () => {
    const { asBot, asUser, channelId, botUserId } = await setup();
    await asUser.mutation(api.messages.send, { channelId, body: "YmVmb3Jl" });
    const cursor = await nowCursor(asBot);

    await asUser.mutation(api.messages.send, { channelId, body: "YWZ0ZXI=" });
    const result = await asBot.query(api.botEvents.poll, { cursor });
    expect(result.events.map((event) => event.type)).toEqual(["message.created"]);
    expect(result.events[0]?.message?.body).toBe("YWZ0ZXI=");
    expect(result.events[0]?.self).toBe(false);
    expect(result.me).toEqual({ userId: botUserId, name: "listener" });
  });

  it("emits created, updated and deleted with an empty deleted body", async () => {
    const { asBot, asUser, channelId } = await setup();
    const cursor = await nowCursor(asBot);

    const messageId = await asUser.mutation(api.messages.send, { channelId, body: "b3JpZ2luYWw=" });
    const created = await asBot.query(api.botEvents.poll, { cursor });
    expect(created.events.map((event) => event.type)).toEqual(["message.created"]);
    expect(created.events[0]?.message?.body).toBe("b3JpZ2luYWw=");

    await asUser.mutation(api.messages.edit, { messageId, body: "ZWRpdGVk" });
    const updated = await asBot.query(api.botEvents.poll, { cursor: created.cursor });
    expect(updated.events.map((event) => event.type)).toEqual(["message.updated"]);
    expect(updated.events[0]?.message?.body).toBe("ZWRpdGVk");

    await asUser.mutation(api.messages.remove, { messageId });
    const deleted = await asBot.query(api.botEvents.poll, { cursor: updated.cursor });
    expect(deleted.events.map((event) => event.type)).toEqual(["message.deleted"]);
    expect(deleted.events[0]?.message?.body).toBe("");
    expect(deleted.events[0]?.message?.deletedAt).toBeTypeOf("number");
  });

  it("never hands out the body of a message deleted after the event was queued", async () => {
    const { asBot, asUser, channelId } = await setup();
    const cursor = await nowCursor(asBot);
    const messageId = await asUser.mutation(api.messages.send, { channelId, body: "c2VjcmV0" });
    await asUser.mutation(api.messages.remove, { messageId });

    const result = await asBot.query(api.botEvents.poll, { cursor });
    expect(result.events.map((event) => event.type)).toEqual([
      "message.created",
      "message.deleted",
    ]);
    expect(result.events.every((event) => event.message?.body === "")).toBe(true);
  });

  it("emits reaction added and removed with the opened emoji", async () => {
    const { asBot, asUser, channelId } = await setup();
    const messageId = await asUser.mutation(api.messages.send, { channelId, body: "aGk=" });
    const cursor = await nowCursor(asBot);

    await asUser.mutation(api.reactions.toggle, { messageId, emoji: "👍" });
    await asUser.mutation(api.reactions.toggle, { messageId, emoji: "👍" });

    const result = await asBot.query(api.botEvents.poll, { cursor });
    expect(result.events.map((event) => event.type)).toEqual([
      "reaction.added",
      "reaction.removed",
    ]);
    expect(result.events[0]?.reaction).toEqual({
      messageId,
      userId: "user-1",
      emoji: "👍",
    });
    expect(result.events[0]?.self).toBe(false);
  });

  it("marks the bot's own actions as self", async () => {
    const { asBot, channelId } = await setup({
      grants: READ_GRANTS | Permission.SendMessages | Permission.AddReactions,
    });
    const cursor = await nowCursor(asBot);
    const messageId = await asBot.mutation(api.messages.send, { channelId, body: "aGk=" });
    await asBot.mutation(api.reactions.toggle, { messageId, emoji: "🔥" });

    const result = await asBot.query(api.botEvents.poll, { cursor });
    expect(result.events.map((event) => event.self)).toEqual([true, true]);
  });

  it("only returns events for channels the bot may see", async () => {
    const { asBot, asUser, channelId } = await setup({ allowedChannelIds: [] });
    await asUser.mutation(api.messages.send, { channelId, body: "aGlkZGVu" });
    const result = await asBot.query(api.botEvents.poll, { cursor: 0 });
    expect(result.events).toEqual([]);
  });

  it("honours the allowed channel list", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const allowed = await seedChannel(t, { name: "allowed" });
    const other = await seedChannel(t, { name: "other" });
    const { userId } = await seedBot(t, { grants: READ_GRANTS, allowedChannelIds: [allowed] });
    const asBot = t.withIdentity({ subject: userId });
    const asUser = t.withIdentity({ subject: "user-1" });

    await asUser.mutation(api.messages.send, { channelId: allowed, body: "YQ==" });
    await asUser.mutation(api.messages.send, { channelId: other, body: "Yg==" });

    const result = await asBot.query(api.botEvents.poll, { cursor: 0 });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.channelId).toBe(allowed);
  });

  it("honours a channel override that denies the bot ViewChannel", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const { userId } = await seedBot(t, { grants: READ_GRANTS });
    const channelId = await seedChannel(t, {
      overrides: [
        { targetId: userId, targetType: "member", allow: 0n, deny: Permission.ViewChannel },
      ],
    });
    await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.messages.send, { channelId, body: "aGlkZGVu" });

    const result = await t.withIdentity({ subject: userId }).query(api.botEvents.poll, {
      cursor: 0,
    });
    expect(result.events).toEqual([]);
  });

  it("pages with cursor and limit", async () => {
    const { asBot, asUser, channelId } = await setup();
    const cursor = await nowCursor(asBot);
    for (let i = 0; i < 5; i += 1) {
      await asUser.mutation(api.messages.send, { channelId, body: `bWVzc2FnZS0${i}` });
    }

    const first = await asBot.query(api.botEvents.poll, { cursor, limit: 2 });
    expect(first.events).toHaveLength(2);
    const second = await asBot.query(api.botEvents.poll, { cursor: first.cursor, limit: 2 });
    expect(second.events).toHaveLength(2);
    expect(second.events[0]?.seq).toBeGreaterThan(first.events[1]?.seq ?? 0);
    const third = await asBot.query(api.botEvents.poll, { cursor: second.cursor, limit: 2 });
    expect(third.events).toHaveLength(1);
    expect(await asBot.query(api.botEvents.poll, { cursor: third.cursor, limit: 2 })).toMatchObject(
      {
        events: [],
      },
    );
  });

  it("advances the cursor past events the bot cannot see", async () => {
    const { asBot, asUser, channelId } = await setup({ allowedChannelIds: [] });
    const cursor = await nowCursor(asBot);
    await asUser.mutation(api.messages.send, { channelId, body: "aGlkZGVu" });
    const hidden = await asBot.query(api.botEvents.poll, { cursor });
    expect(hidden.events).toEqual([]);
    expect(hidden.cursor).toBeGreaterThan(cursor);
  });
});

describe("botEvents emission and retention", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is a no-op when no bot is enabled", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });
    await asUser.mutation(api.messages.send, { channelId, body: "aGk=" });
    await seedBot(t, { enabled: false });
    await asUser.mutation(api.messages.send, { channelId, body: "aGk=" });
    expect(await t.run(async (ctx) => await ctx.db.query("botEvents").collect())).toEqual([]);
  });

  it("prunes only events older than one hour", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [] });
    const channelId = await seedChannel(t);
    const base = Date.now();

    const now = vi.spyOn(Date, "now").mockReturnValue(base);
    await t.run(async (ctx) => {
      await ctx.db.insert("botEvents", { type: "message.created", channelId });
    });
    now.mockReturnValue(base + 2 * 60 * 60 * 1000);
    await t.run(async (ctx) => {
      await ctx.db.insert("botEvents", { type: "message.created", channelId });
    });

    expect(await t.mutation(internal.botEvents.prune, {})).toBeNull();
    const rows = await t.run(async (ctx) => await ctx.db.query("botEvents").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?._creationTime).toBeGreaterThan(base + 60 * 60 * 1000);
  });
});
