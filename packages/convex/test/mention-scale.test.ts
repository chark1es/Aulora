import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { mapInChunks, settleInChunks } from "../convex/lib/concurrency";
import { filterMentionIds, mentionUserIdsForRoles } from "../convex/lib/mentionIds";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

afterEach(() => vi.useRealTimers());

describe("uncapped mentions", () => {
  it.each([false, true])("expands past 500 with backfill complete=%s", async (complete) => {
    const t = newTest();
    const users = Array.from({ length: 605 }, (_, i) => `member-${i}`);
    const { serverId } = await seedWorkspace(t, {
      members: users.map((userId) => ({ userId, roleIds: ["design"] })),
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("roles", {
        key: "design",
        name: "Design",
        position: 1,
        permissions: 0n,
        hoisted: false,
        mentionable: true,
      });
      await ctx.db.patch(serverId, { memberRolesBackfilled: complete });
      // Before completion even a nonempty reverse index is incomplete.
      for (const userId of complete ? users : users.slice(0, 1)) {
        await ctx.db.insert("memberRoles", { userId, roleId: "design", joinedAt: 1 });
      }
    });
    const expanded = await t.run(
      async (ctx) =>
        await mentionUserIdsForRoles(ctx, ["design", "design", "@everyone", "missing"]),
    );
    expect(new Set(expanded)).toEqual(new Set(users));
    expect(expanded).toHaveLength(users.length);
    const filtered = await t.run(
      async (ctx) => await filterMentionIds(ctx, [...users, ...users, "missing"], [], [], "author"),
    );
    expect(filtered.mentionUserIds).toEqual(users);
  });

  it.each([false, true])(
    "chunks thread mentions from root=%s and safely retries",
    async (onRoot) => {
      vi.useFakeTimers();
      const t = newTest();
      const users = Array.from({ length: 251 }, (_, i) => `member-${i}`);
      await seedWorkspace(t, { members: ["author", ...users].map((userId) => ({ userId })) });
      const channelId = await seedChannel(t);
      const author = t.withIdentity({ subject: "author" });
      const rootId = await author.mutation(api.messages.send, {
        channelId,
        body: "root",
        mentionUserIds: onRoot ? users : [],
      });
      const replyId = await author.mutation(api.messages.send, {
        channelId,
        body: "reply",
        threadRootId: rootId,
        mentionUserIds: onRoot ? [] : users,
      });
      const readRows = async () =>
        await t.run(async (ctx) => await ctx.db.query("threadParticipants").collect());
      const synchronous = await readRows();
      expect(synchronous).toHaveLength(101);
      expect(synchronous.find((row) => row.userId === "author")?.participated).toBe(true);
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const rows = await readRows();
      expect(rows).toHaveLength(252);
      expect(rows.filter((row) => row.mentioned)).toHaveLength(251);
      const reply = await t.run(async (ctx) => await ctx.db.get(replyId));
      if (reply === null) throw new Error("Missing reply");
      await t.mutation(internal.messages.continueThreadMentions, {
        threadRootId: rootId,
        channelId,
        at: reply._creationTime - 1,
        userIds: users,
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      expect(await readRows()).toEqual(rows);
    },
  );
});

it("bounds concurrency, keeps order, and attempts every endpoint after rejection", async () => {
  let active = 0;
  let peak = 0;
  const inputs = Array.from({ length: 27 }, (_, i) => i);
  const results = await settleInChunks(inputs, 10, async (i) => {
    active += 1;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active -= 1;
    if (i === 2) throw new Error("endpoint failed");
    return i;
  });
  expect(peak).toBe(10);
  expect(results).toHaveLength(27);
  expect(results[2]?.status).toBe("rejected");
  expect(results[26]).toEqual({ status: "fulfilled", value: 26 });
  expect(await mapInChunks(inputs, 5, async (i) => i)).toEqual(inputs);
});

it("delivers both transports in batches despite individual endpoint failures", async () => {
  const webPush = await import("../convex/lib/webPush");
  const pushRelay = await import("../convex/lib/pushRelay");
  const t = newTest();
  const users = Array.from({ length: 27 }, (_, i) => `listener-${i}`);
  await seedWorkspace(t, { members: users.map((userId) => ({ userId })) });
  const channelId = await seedChannel(t, { memberIds: users });
  const messageId = await t.run(async (ctx) => {
    for (const userId of users) {
      await ctx.db.insert("devices", {
        userId,
        platform: "web",
        lastSeen: 1,
        pushToken: JSON.stringify({
          endpoint: `https://push.example.com/${userId}`,
          keys: { p256dh: "key", auth: "auth" },
        }),
      });
      await ctx.db.insert("devices", { userId, platform: "ios", lastSeen: 1, pushToken: userId });
    }
    return await ctx.db.insert("messages", {
      channelId,
      authorId: "author",
      ciphertext: "legacy",
      attachmentIds: [],
      mentionUserIds: [],
    });
  });
  let webActive = 0;
  let mobileActive = 0;
  let webPeak = 0;
  let mobilePeak = 0;
  const webCalls: string[] = [];
  const mobileCalls: string[] = [];
  vi.spyOn(webPush, "vapidConfigFromEnv").mockReturnValue({
    publicKey: "synthetic",
    privateKey: "synthetic",
    subject: "mailto:test@example.com",
  });
  vi.spyOn(pushRelay, "pushRelayConfigFromEnv").mockReturnValue({
    url: "https://relay.example.com",
    token: "synthetic",
    serverId: "server",
  });
  vi.spyOn(webPush, "sendWebPush").mockImplementation(async (subscription) => {
    webCalls.push(subscription.endpoint);
    webPeak = Math.max(webPeak, ++webActive);
    await Promise.resolve();
    webActive -= 1;
    if (subscription.endpoint.endsWith("listener-2")) throw new Error("transport failure");
    return { ok: true, status: 201, gone: false };
  });
  vi.spyOn(pushRelay, "sendWake").mockImplementation(async (payload) => {
    mobileCalls.push(payload.token);
    mobilePeak = Math.max(mobilePeak, ++mobileActive);
    await Promise.resolve();
    mobileActive -= 1;
    return {
      ok: payload.token !== "listener-2",
      status: payload.token === "listener-2" ? 500 : 200,
    };
  });
  try {
    expect(await t.action(internal.notifications.dispatchForMessage, { messageId })).toEqual({
      sent: 52,
    });
    expect(webCalls).toHaveLength(27);
    expect(mobileCalls).toHaveLength(27);
    expect(webPeak).toBe(10);
    expect(mobilePeak).toBe(10);
    // Delivery has no token-pruning behavior; a failed endpoint stays registered.
    expect(await t.run(async (ctx) => (await ctx.db.query("devices").collect()).length)).toBe(54);
  } finally {
    vi.restoreAllMocks();
  }
});
