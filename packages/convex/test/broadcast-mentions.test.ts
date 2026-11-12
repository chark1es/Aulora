import { Permission } from "@aulora/core";
import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { BROADCAST_BATCH_SIZE } from "../convex/lib/broadcastMentions";
import { EVERYONE_BASE, newTest, seedChannel, seedWorkspace } from "./helpers";

afterEach(() => vi.useRealTimers());

it("silently ignores unauthorized markers, requires whole tokens, and defaults old responses", async () => {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "author" }] });
  const channelId = await seedChannel(t);
  const author = t.withIdentity({ subject: "author" });
  const denied = await author.mutation(api.messages.send, {
    channelId,
    body: "@everyone @here",
    mentionEveryone: true,
    mentionHere: true,
  });
  expect(await t.run(async (ctx) => await ctx.db.get(denied))).toMatchObject({
    mentionUserIds: [],
  });
  const owner = t.withIdentity({ subject: "owner-1" });
  const invalid = await owner.mutation(api.messages.send, {
    channelId,
    body: "@everyone.foo @here-after",
    mentionEveryone: true,
    mentionHere: true,
  });
  expect((await t.run(async (ctx) => await ctx.db.get(invalid)))?.mentionEveryone).toBeUndefined();
  await t.run(async (ctx) => {
    await ctx.db.insert("messages", {
      channelId,
      authorId: "author",
      ciphertext: "old",
      attachmentIds: [],
      mentionUserIds: [],
    });
  });
  const list = await author.query(api.messages.list, {
    channelId,
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(list.page.every((row) => row.mentionEveryone === false && row.mentionHere === false)).toBe(
    true,
  );
  expect((await t.query(api.server.publicConfig)).capabilities).toMatchObject({
    mentionMarkers: true,
  });
});

it.each(["private"] as const)(
  "restricts %s broadcasts to current members and applies preferences",
  async (kind) => {
    const t = newTest();
    const users = ["author", "allowed", "muted", "suppressed", "dnd", "outsider", "banned"];
    await seedWorkspace(t, {
      everyonePermissions: EVERYONE_BASE | Permission.MentionEveryone,
      members: users.map((userId) => ({ userId })),
    });
    const channelId = await seedChannel(t, {
      kind: kind === "private" ? "text" : kind,
      private: kind === "private",
      memberIds: [...users.filter((id) => id !== "outsider"), "deleted"],
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("bans", { userId: "banned", actorId: "owner-1", at: Date.now() });
      await ctx.db.insert("notificationPrefs", {
        userId: "muted",
        scope: "channel",
        channelId,
        level: "nothing",
      });
      await ctx.db.insert("notificationPrefs", {
        userId: "suppressed",
        scope: "server",
        level: "mentions",
        suppressMassMentions: true,
      });
      await ctx.db.insert("presence", {
        userId: "dnd",
        status: "dnd",
        lastHeartbeat: Date.now() - 80_000,
      });
    });
    const id = await t
      .withIdentity({ subject: "author" })
      .mutation(api.messages.send, { channelId, body: "@EVERYONE!", mentionEveryone: true });
    expect(
      (await t.query(internal.notifications.recipientPage, { messageId: id })).recipients,
    ).toEqual(["allowed"]);
    expect(await t.run(async (ctx) => await ctx.db.get(id))).toMatchObject({
      mentionEveryone: true,
    });
  },
);

it("pushes @here only to online inactive devices, but badges all viewers without writes", async () => {
  vi.useFakeTimers();
  const t = newTest();
  const users = ["author", "online", "active", "offline", "stale"];
  await seedWorkspace(t, {
    everyonePermissions: EVERYONE_BASE | Permission.MentionEveryone,
    members: users.map((userId) => ({ userId })),
  });
  const channelId = await seedChannel(t, { memberIds: users });
  await t.run(async (ctx) => {
    for (const [userId, status, age] of [
      ["online", "online", 80_000],
      ["active", "online", 0],
      ["offline", "offline", 0],
      ["stale", "online", 160_000],
    ] as const) {
      await ctx.db.insert("presence", { userId, status, lastHeartbeat: Date.now() - age });
    }
  });
  const id = await t
    .withIdentity({ subject: "author" })
    .mutation(api.messages.send, { channelId, body: "@here", mentionHere: true });
  // Simulate a marker-only message independently of compatibility expansion.
  await t.run(async (ctx) => await ctx.db.patch(id, { mentionUserIds: [] }));
  expect(
    (await t.query(internal.notifications.recipientPage, { messageId: id })).recipients,
  ).toEqual(["online"]);
  const offline = t.withIdentity({ subject: "offline" });
  expect(await offline.query(api.notifications.unreadSummary)).toEqual({ total: 1, mentions: 1 });
  expect(await offline.query(api.readStates.summary, { channelIds: [channelId] })).toEqual(
    expect.arrayContaining([expect.objectContaining({ channelId, mentionCount: 1 })]),
  );
  expect(await t.run(async (ctx) => await ctx.db.query("readStates").collect())).toEqual([]);
  expect(await t.run(async (ctx) => await ctx.db.query("threadParticipants").collect())).toEqual(
    [],
  );
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
});

it.each([100, 101, BROADCAST_BATCH_SIZE + 7])(
  "keeps broadcasts uncapped with %s members and cursor-only chunks",
  async (size) => {
    const t = newTest();
    const users = Array.from({ length: size }, (_, i) => `user-${i}`);
    await seedWorkspace(t, {
      everyonePermissions: EVERYONE_BASE | Permission.MentionEveryone,
      members: users.map((userId) => ({ userId })),
    });
    const channelId = await seedChannel(t);
    const id = await t
      .withIdentity({ subject: "user-0" })
      .mutation(api.messages.send, { channelId, body: "@everyone", mentionEveryone: true });
    const row = await t.run(async (ctx) => await ctx.db.get(id));
    expect(row?.mentionUserIds.length).toBe(size < 100 ? size + 1 : 0);
    const first = await t.query(internal.notifications.recipientPage, { messageId: id });
    const recipients = [...first.recipients];
    if (size > BROADCAST_BATCH_SIZE) {
      expect(first.cursor).toEqual(expect.any(String));
      if (first.cursor === null) throw new Error("Missing continuation");
      const next = await t.query(internal.notifications.recipientPage, {
        messageId: id,
        cursor: first.cursor,
      });
      expect(next.cursor).toBe(null);
      recipients.push(...next.recipients);
    }
    expect(new Set(recipients)).toEqual(new Set([...users.slice(1), "owner-1"]));
  },
);

it("keeps old expanded-id calls unchanged and exposes optional suppression preferences", async () => {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "author" }, { userId: "viewer" }] });
  const channelId = await seedChannel(t, { memberIds: ["author", "viewer"] });
  const id = await t
    .withIdentity({ subject: "author" })
    .mutation(api.messages.send, { channelId, body: "@everyone", mentionUserIds: ["viewer"] });
  expect(await t.run(async (ctx) => await ctx.db.get(id))).toMatchObject({
    mentionUserIds: ["viewer"],
  });
  expect(await t.query(internal.notifications.resolveRecipients, { messageId: id })).toEqual([
    "viewer",
  ]);
  const viewer = t.withIdentity({ subject: "viewer" });
  await viewer.mutation(api.notifications.setPref, {
    scope: "server",
    level: "all",
    suppressMassMentions: true,
  });
  expect(await viewer.query(api.notifications.getPrefs)).toEqual([
    expect.objectContaining({ suppressMassMentions: true }),
  ]);
});

it("ignores broadcast markers in thread replies", async () => {
  vi.useFakeTimers();
  const t = newTest();
  await seedWorkspace(t, {
    everyonePermissions: EVERYONE_BASE | Permission.MentionEveryone,
    members: [{ userId: "author" }, { userId: "viewer" }],
  });
  const channelId = await seedChannel(t, { memberIds: ["author", "viewer"] });
  const author = t.withIdentity({ subject: "author" });
  const root = await author.mutation(api.messages.send, { channelId, body: "root" });
  await author.mutation(api.messages.send, {
    channelId,
    body: "@everyone",
    mentionEveryone: true,
    threadRootId: root,
  });
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  const rows = await t.run(async (ctx) => await ctx.db.query("threadParticipants").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]?.userId).toBe("author");
  const viewer = t.withIdentity({ subject: "viewer" });
  expect(await viewer.query(api.messages.threadMentionCount)).toBe(0);
  expect(await viewer.query(api.messages.threadInbox, {})).toEqual([]);
  expect(await author.query(api.messages.threadMentionCount)).toBe(0);
});

it("finishes legacy expansion for a small visible audience in a large workspace", async () => {
  vi.useFakeTimers();
  const t = newTest();
  const users = Array.from({ length: 250 }, (_, i) => `user-${i}`);
  await seedWorkspace(t, {
    everyonePermissions: EVERYONE_BASE | Permission.MentionEveryone,
    members: users.map((userId) => ({ userId })),
  });
  const channelId = await seedChannel(t, {
    overrides: [
      { targetType: "role", targetId: "@everyone", deny: Permission.ViewChannel, allow: 0n },
      { targetType: "member", targetId: "user-0", allow: Permission.ViewChannel, deny: 0n },
      { targetType: "member", targetId: "user-249", allow: Permission.ViewChannel, deny: 0n },
    ],
  });
  const id = await t
    .withIdentity({ subject: "user-0" })
    .mutation(api.messages.send, { channelId, body: "@everyone", mentionEveryone: true });
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  const row = await t.run(async (ctx) => await ctx.db.get(id));
  expect(new Set(row?.mentionUserIds)).toEqual(new Set(["user-0", "user-249", "owner-1"]));
  expect(await t.run(async (ctx) => await ctx.db.query("broadcastMentionJobs").collect())).toEqual(
    [],
  );
});

it("schedules every broadcast delivery page with cursor-only continuations", async () => {
  vi.useFakeTimers();
  const relay = await import("../convex/lib/pushRelay");
  const web = await import("../convex/lib/webPush");
  vi.spyOn(web, "vapidConfigFromEnv").mockReturnValue(null);
  vi.spyOn(relay, "pushRelayConfigFromEnv").mockReturnValue({
    url: "https://relay.example.com",
    token: "synthetic",
    serverId: "server",
  });
  const send = vi.spyOn(relay, "sendWake").mockResolvedValue({ ok: true, status: 200 });
  try {
    const t = newTest();
    const users = Array.from({ length: BROADCAST_BATCH_SIZE + 7 }, (_, i) => `user-${i}`);
    await seedWorkspace(t, {
      everyonePermissions: EVERYONE_BASE | Permission.MentionEveryone,
      members: users.map((userId) => ({ userId })),
    });
    const channelId = await seedChannel(t);
    await t.run(async (ctx) => {
      for (const userId of users)
        await ctx.db.insert("devices", { userId, platform: "ios", lastSeen: 1, pushToken: userId });
    });
    const messageId = await t
      .withIdentity({ subject: "user-0" })
      .mutation(api.messages.send, { channelId, body: "@everyone", mentionEveryone: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(send).toHaveBeenCalledTimes(users.length - 1);
    await t.action(api.notifications.dispatchNow, { messageId });
    await t.action(api.notifications.dispatchNow, { messageId });
    await t.action(internal.notifications.dispatchForMessage, { messageId });
    expect(send).toHaveBeenCalledTimes(users.length - 1);
    expect(new Set(send.mock.calls.map(([payload]) => payload.token))).toEqual(
      new Set(users.slice(1)),
    );
    expect(await t.run(async (ctx) => await ctx.db.query("threadParticipants").collect())).toEqual(
      [],
    );
  } finally {
    vi.restoreAllMocks();
  }
});

it("preserves explicit mentions alongside @here and keeps root broadcasts out of participation rows", async () => {
  vi.useFakeTimers();
  const t = newTest();
  await seedWorkspace(t, {
    everyonePermissions: EVERYONE_BASE | Permission.MentionEveryone,
    members: [{ userId: "author" }, { userId: "direct" }, { userId: "broadcast" }],
  });
  const channelId = await seedChannel(t, { memberIds: ["author", "direct", "broadcast"] });
  await t.run(async (ctx) => {
    await ctx.db.insert("notificationPrefs", {
      userId: "direct",
      scope: "server",
      level: "mentions",
      suppressMassMentions: true,
    });
  });
  const author = t.withIdentity({ subject: "author" });
  const root = await author.mutation(api.messages.send, {
    channelId,
    body: "@here @direct",
    mentionHere: true,
    mentionUserIds: ["direct"],
  });
  expect(
    (await t.query(internal.notifications.recipientPage, { messageId: root })).recipients,
  ).toEqual(["direct"]);
  await author.mutation(api.messages.send, { channelId, body: "reply", threadRootId: root });
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  const participants = await t.run(
    async (ctx) => await ctx.db.query("threadParticipants").collect(),
  );
  expect(participants.map((row) => row.userId).sort()).toEqual(["author", "direct"]);
  expect(
    await t.withIdentity({ subject: "broadcast" }).query(api.messages.threadMentionCount),
  ).toBe(0);
});
