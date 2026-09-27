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
