import { Permission } from "@aulora/core";
import { afterEach, describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { bytesToBase64Url } from "../convex/lib/webPush";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

async function makeVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const rawPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: bytesToBase64Url(rawPublic), privateKey: privateJwk.d as string };
}

const ORIGINAL_FETCH = globalThis.fetch;
const PAGE = { numItems: 50, cursor: null } as const;

afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("notification preferences", () => {
  it("round-trips server and channel preferences", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { memberIds: ["user-1"] });
    const asUser = t.withIdentity({ subject: "user-1" });

    await asUser.mutation(api.notifications.setPref, { scope: "server", level: "mentions" });
    await asUser.mutation(api.notifications.setPref, {
      scope: "channel",
      channelId,
      level: "nothing",
      muteUntil: 1_700_000_000_000,
    });

    const prefs = await asUser.query(api.notifications.getPrefs);
    expect(prefs).toHaveLength(2);
    expect(prefs.find((pref) => pref.scope === "server")).toMatchObject({ level: "mentions" });
    expect(prefs.find((pref) => pref.scope === "channel")).toMatchObject({
      level: "nothing",
      channelId,
      muteUntil: 1_700_000_000_000,
    });
  });

  it("requires ViewChannel for a channel-scoped preference", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ReadHistory,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t, { memberIds: ["user-1"] });
    const asUser = t.withIdentity({ subject: "user-1" });
    await expect(
      asUser.mutation(api.notifications.setPref, { scope: "channel", channelId, level: "all" }),
    ).rejects.toThrow("Missing permission");
  });

  it("rejects a channelId on a server-scoped preference", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { memberIds: ["user-1"] });
    const asUser = t.withIdentity({ subject: "user-1" });
    await expect(
      asUser.mutation(api.notifications.setPref, { scope: "server", channelId, level: "all" }),
    ).rejects.toThrow("Server scope must not set a channelId");
  });

  it("hides and mutes a channel per viewer without affecting others", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1" }, { userId: "user-2" }],
    });
    const channelId = await seedChannel(t, { memberIds: ["user-1", "user-2"] });
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const asUser2 = t.withIdentity({ subject: "user-2" });

    await asUser1.mutation(api.notifications.setChannelHidden, { channelId, hidden: true });
    await asUser1.mutation(api.notifications.setChannelMuted, { channelId, muted: true });

    const prefs = await asUser1.query(api.notifications.getPrefs);
    expect(prefs.find((pref) => pref.scope === "channel")).toMatchObject({
      channelId,
      hidden: true,
      muted: true,
      level: "nothing",
    });
    expect(await asUser2.query(api.notifications.getPrefs)).toHaveLength(0);

    const list1 = await asUser1.query(api.channels.list, { paginationOpts: PAGE });
    const channel1 = list1.page.find((channel) => channel.id === channelId);
    expect(channel1).toMatchObject({ hidden: true, muted: true });

    const list2 = await asUser2.query(api.channels.list, { paginationOpts: PAGE });
    const channel2 = list2.page.find((channel) => channel.id === channelId);
    expect(channel2).toMatchObject({ hidden: false, muted: false });

    await asUser1.mutation(api.notifications.setChannelMuted, { channelId, muted: false });
    await asUser1.mutation(api.notifications.setChannelHidden, { channelId, hidden: false });
    const after = await asUser1.query(api.notifications.getPrefs);
    expect(after.find((pref) => pref.scope === "channel")).toMatchObject({
      hidden: false,
      muted: false,
      level: "all",
    });
  });

  it("requires ViewChannel to hide or mute", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ReadHistory,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t, { memberIds: ["user-1"] });
    const asUser = t.withIdentity({ subject: "user-1" });
    await expect(
      asUser.mutation(api.notifications.setChannelHidden, { channelId, hidden: true }),
    ).rejects.toThrow("Missing permission");
    await expect(
      asUser.mutation(api.notifications.setChannelMuted, { channelId, muted: true }),
    ).rejects.toThrow("Missing permission");
  });
});

describe("notifications.unreadSummary", () => {
  it("counts others' messages after the read cursor and mentions", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, { memberIds: ["user-1", "user-2"] });
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const asUser2 = t.withIdentity({ subject: "user-2" });

    const first = await asUser1.mutation(api.messages.send, {
      channelId,
      body: "bXNn",
    });
    await asUser1.mutation(api.messages.send, {
      channelId,
      body: "bXNn",
      mentionUserIds: ["user-2"],
    });

    expect(await asUser2.query(api.notifications.unreadSummary)).toEqual({ total: 2, mentions: 1 });

    await asUser2.mutation(api.readStates.set, { channelId, lastReadMessageId: first });
    expect(await asUser2.query(api.notifications.unreadSummary)).toEqual({ total: 1, mentions: 1 });

    // The author never counts their own messages.
    expect(await asUser1.query(api.notifications.unreadSummary)).toEqual({ total: 0, mentions: 0 });
  });
});

describe("notifications.resolveRecipients", () => {
  it("excludes the author and applies per-user preferences", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "author" }, { userId: "muted" }, { userId: "mentions-only" }],
    });
    const channelId = await seedChannel(t, { memberIds: ["author", "muted", "mentions-only"] });
    const asMuted = t.withIdentity({ subject: "muted" });
    await asMuted.mutation(api.notifications.setPref, { scope: "server", level: "nothing" });
    const asMentions = t.withIdentity({ subject: "mentions-only" });
    await asMentions.mutation(api.notifications.setPref, { scope: "server", level: "mentions" });

    const asAuthor = t.withIdentity({ subject: "author" });
    const messageId = await asAuthor.mutation(api.messages.send, {
      channelId,
      body: "bXNn",
      mentionUserIds: ["mentions-only"],
    });

    const recipients = await t.query(internal.notifications.resolveRecipients, { messageId });
    expect(recipients.sort()).toEqual(["mentions-only"]);
  });

  it("skips users who are currently active", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "author" }, { userId: "active" }] });
    const channelId = await seedChannel(t, { memberIds: ["author", "active"] });
    const asActive = t.withIdentity({ subject: "active" });
    await asActive.mutation(api.presence.heartbeat, { status: "online" });
    const asAuthor = t.withIdentity({ subject: "author" });
    const messageId = await asAuthor.mutation(api.messages.send, {
      channelId,
      body: "bXNn",
    });
    const recipients = await t.query(internal.notifications.resolveRecipients, { messageId });
    expect(recipients).toEqual([]);
  });

  it("notifies the members of a mentioned channel", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "author" }, { userId: "listener" }] });
    const channelId = await seedChannel(t, { memberIds: ["author"] });
    const mentionedId = await seedChannel(t, { memberIds: ["listener"] });
    const asAuthor = t.withIdentity({ subject: "author" });
    const messageId = await asAuthor.mutation(api.messages.send, {
      channelId,
      body: "bXNn",
      mentionChannelIds: [mentionedId],
    });
    const recipients = await t.query(internal.notifications.resolveRecipients, { messageId });
    expect(recipients).toEqual(["listener"]);
  });

  it("notifies members of channels in a mentioned category, never the author", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "author" }, { userId: "listener" }, { userId: "outsider" }],
    });
    const categoryId = await t.run(
      async (ctx) =>
        await ctx.db.insert("categories", { name: "team", position: 0, overrides: [] }),
    );
    const channelId = await seedChannel(t, { memberIds: ["author"] });
    await seedChannel(t, { memberIds: ["listener"], categoryId });
    await seedChannel(t, { memberIds: ["outsider"] });
    const asAuthor = t.withIdentity({ subject: "author" });
    const messageId = await asAuthor.mutation(api.messages.send, {
      channelId,
      body: "bXNn",
      mentionCategoryIds: [categoryId],
    });
    const recipients = await t.query(internal.notifications.resolveRecipients, { messageId });
    expect(recipients.sort()).toEqual(["listener"]);
  });

  it("treats a mentioned member bound by a mention-only preference as notified", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "author" }, { userId: "listener" }] });
    const channelId = await seedChannel(t, { memberIds: ["author"] });
    const mentionedId = await seedChannel(t, { memberIds: ["listener"] });
    const asListener = t.withIdentity({ subject: "listener" });
    await asListener.mutation(api.notifications.setPref, { scope: "server", level: "mentions" });
    const asAuthor = t.withIdentity({ subject: "author" });
    const messageId = await asAuthor.mutation(api.messages.send, {
      channelId,
      body: "bXNn",
      mentionChannelIds: [mentionedId],
    });
    const recipients = await t.query(internal.notifications.resolveRecipients, { messageId });
    expect(recipients).toEqual(["listener"]);
  });
});

describe("notifications.mobilePushTargets", () => {
  it("accepts a generic `mobile` platform tag as a native target", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    await t.run(async (ctx) => {
      await ctx.db.insert("devices", {
        userId: "user-1",
        platform: "mobile",
        pushToken: "fcm-token",
        lastSeen: Date.now(),
      });
    });
    const targets = await t.query(internal.notifications.mobilePushTargets, {
      userIds: ["user-1"],
    });
    expect(targets).toEqual([{ userId: "user-1", platform: "mobile", token: "fcm-token" }]);
  });
});

describe("notifications.dispatchForMessage", () => {
  it("no-ops without VAPID configuration", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, { memberIds: ["user-1", "user-2"] });
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const messageId = await asUser1.mutation(api.messages.send, {
      channelId,
      body: "bXNn",
    });
    const result = await t.action(internal.notifications.dispatchForMessage, { messageId });
    expect(result).toEqual({ sent: 0, skipped: "unconfigured" });
  });

  it("sends an empty-body push to each stored web subscription", async () => {
    const keys = await makeVapidKeys();
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    process.env.VAPID_SUBJECT = "mailto:owner@example.com";

    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, { memberIds: ["user-1", "user-2"] });
    await t.run(async (ctx) => {
      await ctx.db.insert("devices", {
        userId: "user-2",
        platform: "web",
        lastSeen: Date.now(),
        pushToken: JSON.stringify({
          endpoint: "https://push.example.com/sub/device-2",
          keys: { p256dh: "p256dh", auth: "auth" },
        }),
      });
    });

    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("", { status: 201 });
    }) as typeof fetch;

    const asUser1 = t.withIdentity({ subject: "user-1" });
    const messageId = await asUser1.mutation(api.messages.send, {
      channelId,
      body: "bXNn",
    });
    // `messages.send` also schedules `dispatchForMessage` on a `runAfter(0)`
    // timer. Drain it deterministically before measuring, otherwise that
    // background dispatch races the explicit one below and double-counts.
    await t.finishAllScheduledFunctions(() => {});
    calls.length = 0;
    const result = await t.action(internal.notifications.dispatchForMessage, { messageId });
    expect(result).toEqual({ sent: 1 });
    expect(calls).toEqual(["https://push.example.com/sub/device-2"]);
  });
});
