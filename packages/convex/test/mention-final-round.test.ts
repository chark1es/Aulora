import { Permission } from "@aulora/core";
import { expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { QueryCtx } from "../convex/_generated/server";
import { EVERYONE_BASE, newTest, seedChannel, seedWorkspace } from "./helpers";

it("exposes direct snapshots only when stored and classifies mass-only summary mentions", async () => {
  const t = newTest();
  await seedWorkspace(t, {
    everyonePermissions: EVERYONE_BASE | Permission.MentionEveryone,
    members: [{ userId: "author" }, { userId: "viewer" }],
  });
  const channelId = await seedChannel(t);
  const author = t.withIdentity({ subject: "author" });
  const viewer = t.withIdentity({ subject: "viewer" });
  const plain = await author.mutation(api.messages.send, { channelId, body: "plain" });
  const mass = await author.mutation(api.messages.send, {
    channelId,
    body: "@everyone",
    mentionEveryone: true,
  });
  const direct = await author.mutation(api.messages.send, {
    channelId,
    body: "@here viewer",
    mentionHere: true,
    mentionUserIds: ["viewer"],
  });
  const rows = await viewer.query(api.messages.list, {
    channelId,
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(rows.page.find((r) => r.id === plain)).not.toHaveProperty("broadcastDirectUserIds");
  expect(rows.page.find((r) => r.id === mass)?.broadcastDirectUserIds).toEqual([]);
  expect(rows.page.find((r) => r.id === direct)?.broadcastDirectUserIds).toEqual(["viewer"]);
  const summary = await viewer.query(api.readStates.summary, { channelIds: [channelId] });
  expect(summary[0]).toMatchObject({ mentionCount: 2, massMentionCount: 1 });
});

it("excludes self mentions from read-state badges", async () => {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "author" }] });
  const channelId = await seedChannel(t);
  const author = t.withIdentity({ subject: "author" });
  await author.mutation(api.messages.send, { channelId, body: "self", mentionUserIds: ["author"] });
  expect(await author.mutation(api.readStates.set, { channelId })).toMatchObject({
    mentionCount: 0,
  });
});

it("acknowledges only own mentions through a watermark and lets later mentions rearm", async () => {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "viewer" }, { userId: "other" }] });
  const channelId = await seedChannel(t);
  const root = await t.run(async (ctx) => {
    const root = await ctx.db.insert("messages", {
      channelId,
      authorId: "author",
      ciphertext: "root",
      attachmentIds: [],
      mentionUserIds: ["viewer"],
      replyCount: 1,
    });
    for (const userId of ["viewer", "other"])
      await ctx.db.insert("threadParticipants", {
        userId,
        threadRootId: root,
        channelId,
        mentioned: true,
        participated: false,
        lastReplyAt: 10,
      });
    return root;
  });
  const viewer = t.withIdentity({ subject: "viewer" });
  expect(await viewer.mutation(api.messages.markThreadMentionsSeen, { lastReplyAt: 9 })).toEqual({
    cleared: 0,
    hasMore: false,
  });
  expect(await viewer.query(api.messages.threadMentionCount)).toBe(1);
  expect(await viewer.mutation(api.messages.markThreadMentionsSeen, { lastReplyAt: 10 })).toEqual({
    cleared: 1,
    hasMore: false,
  });
  expect(await viewer.query(api.messages.threadMentionCount)).toBe(0);
  expect((await viewer.query(api.messages.threadInbox, {}))[0]?.viewerMentioned).toBe(false);
  expect(await t.withIdentity({ subject: "other" }).query(api.messages.threadMentionCount)).toBe(1);
  await t.mutation(internal.messages.continueThreadMentions, {
    threadRootId: root,
    channelId,
    at: 11,
    userIds: ["viewer"],
  });
  expect(await viewer.query(api.messages.threadMentionCount)).toBe(1);
  await expect(
    t.withIdentity({ subject: "outsider" }).mutation(api.messages.markThreadMentionsSeen, {}),
  ).rejects.toThrow();
});

it("copies workspace level and mute deadline when hiding creates channel preferences", async () => {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "viewer" }] });
  const channelId = await seedChannel(t);
  await t.run((ctx) =>
    ctx.db.insert("notificationPrefs", {
      userId: "viewer",
      scope: "server",
      level: "mentions",
      muteUntil: 123456,
      suppressMassMentions: true,
    }),
  );
  await t
    .withIdentity({ subject: "viewer" })
    .mutation(api.notifications.setChannelHidden, { channelId, hidden: true });
  const prefs = await t.run(
    async (ctx: QueryCtx) =>
      await ctx.db
        .query("notificationPrefs")
        .withIndex("by_user_channel", (q) => q.eq("userId", "viewer").eq("channelId", channelId))
        .unique(),
  );
  expect(prefs).toMatchObject({ level: "mentions", muteUntil: 123456 });
  expect(prefs?.suppressMassMentions).toBeUndefined();
});

it("bounds acknowledgement batches and keeps mentions newer than the watermark", async () => {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "viewer" }] });
  const channelId = await seedChannel(t);
  await t.run(async (ctx) => {
    const root = await ctx.db.insert("messages", {
      channelId,
      authorId: "author",
      ciphertext: "root",
      attachmentIds: [],
      mentionUserIds: [],
      replyCount: 1,
    });
    for (let i = 0; i < 60; i++)
      await ctx.db.insert("threadParticipants", {
        userId: "viewer",
        threadRootId: root,
        channelId,
        lastReplyAt: i,
        mentioned: true,
      });
  });
  const viewer = t.withIdentity({ subject: "viewer" });
  expect(await viewer.mutation(api.messages.markThreadMentionsSeen, { lastReplyAt: 54 })).toEqual({
    cleared: 50,
    hasMore: true,
  });
  expect(await viewer.mutation(api.messages.markThreadMentionsSeen, { lastReplyAt: 54 })).toEqual({
    cleared: 5,
    hasMore: false,
  });
  expect(await viewer.query(api.messages.threadMentionCount)).toBe(5);
});

it("bounds manual thread repair writes even for large stored mention and replier arrays", async () => {
  const t = newTest();
  await seedWorkspace(t);
  const channelId = await seedChannel(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("messages", {
      channelId,
      authorId: "author",
      ciphertext: "root",
      attachmentIds: [],
      mentionUserIds: Array.from({ length: 250 }, (_, i) => `mention${i}`),
      replyParticipantIds: Array.from({ length: 250 }, (_, i) => `reply${i}`),
      replyCount: 1,
    });
  });
  // The documented operator entry point; further batches are scheduled, not written here.
  await t.mutation(internal.maintenance.backfillThreadParticipants, {});
  const rows = await t.run(async (ctx) => await ctx.db.query("threadParticipants").take(201));
  expect(rows).toHaveLength(200);
});
