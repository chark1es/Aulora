import { afterEach, describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { pushRelayConfigFromEnv, sendWake } from "../convex/lib/pushRelay";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  delete process.env.PUSH_RELAY_URL;
  delete process.env.PUSH_RELAY_TOKEN;
  delete process.env.AULORA_SERVER_ID;
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("pushRelay config", () => {
  it("is null until both URL and token are set", () => {
    expect(pushRelayConfigFromEnv({})).toBeNull();
    expect(pushRelayConfigFromEnv({ PUSH_RELAY_URL: "https://relay" })).toBeNull();
    const config = pushRelayConfigFromEnv({
      PUSH_RELAY_URL: "https://relay.example.com/",
      PUSH_RELAY_TOKEN: "secret",
      AULORA_SERVER_ID: "srv-1",
    });
    expect(config).toEqual({
      url: "https://relay.example.com",
      token: "secret",
      serverId: "srv-1",
    });
  });
});

describe("sendWake", () => {
  it("posts a content-free wake with the bearer secret", async () => {
    const calls: { url: string; body: Record<string, unknown>; auth: string }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
        auth: String(headers.authorization),
      });
      return new Response("", { status: 202 });
    }) as typeof fetch;

    const result = await sendWake(
      {
        kind: "message",
        serverId: "srv-1",
        channelId: "chan-1",
        messageId: "msg-1",
        platform: "ios",
        token: "apns-token",
      },
      { url: "https://relay.example.com", token: "secret", serverId: "srv-1" },
    );
    expect(result).toEqual({ ok: true, status: 202 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://relay.example.com/v1/wake");
    expect(calls[0]?.auth).toBe("Bearer secret");
    expect(calls[0]?.body).toEqual({
      v: 1,
      kind: "message",
      serverId: "srv-1",
      channelId: "chan-1",
      messageId: "msg-1",
      platform: "ios",
      token: "apns-token",
    });
    expect(JSON.stringify(calls[0]?.body)).not.toMatch(/text|ciphertext|plaintext/);
  });

  it("reports a failure instead of throwing", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const result = await sendWake(
      {
        kind: "call",
        serverId: "srv-1",
        channelId: "c",
        messageId: "m",
        platform: "android",
        token: "fcm",
      },
      { url: "https://relay", token: "t", serverId: "srv-1" },
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
  });
});

describe("notifications.dispatchMobileForMessage", () => {
  it("no-ops without relay configuration", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, { memberIds: ["user-1", "user-2"] });
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const messageId = await asUser1.mutation(api.messages.send, {
      channelId,
      body: "bXNn",
    });
    const result = await t.action(internal.notifications.dispatchMobileForMessage, { messageId });
    expect(result).toEqual({ sent: 0, skipped: "unconfigured" });
  });

  it("routes native tokens to the relay and skips web subscriptions", async () => {
    process.env.PUSH_RELAY_URL = "https://relay.example.com";
    process.env.PUSH_RELAY_TOKEN = "secret";
    process.env.AULORA_SERVER_ID = "srv-1";

    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1" }, { userId: "user-2" }, { userId: "user-3" }],
    });
    const channelId = await seedChannel(t, { memberIds: ["user-1", "user-2", "user-3"] });
    await t.run(async (ctx) => {
      await ctx.db.insert("devices", {
        userId: "user-2",
        platform: "ios",
        pushToken: "apns-token",
        lastSeen: Date.now(),
      });
      await ctx.db.insert("devices", {
        userId: "user-3",
        platform: "web",
        pushToken: JSON.stringify({
          endpoint: "https://push.example.com/sub",
          keys: { p256dh: "p", auth: "a" },
        }),
        lastSeen: Date.now(),
      });
    });

    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response("", { status: 200 });
    }) as typeof fetch;

    const asUser1 = t.withIdentity({ subject: "user-1" });
    const messageId = await asUser1.mutation(api.messages.send, {
      channelId,
      body: "bXNn",
    });
    const result = await t.action(internal.notifications.dispatchMobileForMessage, { messageId });
    expect(result).toEqual({ sent: 1 });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.platform).toBe("ios");
    expect(bodies[0]?.token).toBe("apns-token");
    expect(bodies[0]?.messageId).toBe(messageId);
    expect(bodies[0]?.channelId).toBe(channelId);
  });
});

describe("notifications.dispatchMobileCallRinging", () => {
  it("no-ops without relay configuration", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, { kind: "dm", memberIds: ["user-1", "user-2"] });
    const { callId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });
    const result = await t.action(internal.notifications.dispatchMobileCallRinging, { callId });
    expect(result).toEqual({ sent: 0, skipped: "unconfigured" });
  });

  it("wakes each ringing native device through the relay", async () => {
    process.env.PUSH_RELAY_URL = "https://relay.example.com";
    process.env.PUSH_RELAY_TOKEN = "secret";
    process.env.AULORA_SERVER_ID = "srv-1";

    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, {
      kind: "dm",
      memberIds: ["user-1", "user-2"],
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("devices", {
        userId: "user-2",
        platform: "ios",
        pushToken: "apns-token",
        lastSeen: Date.now(),
      });
    });

    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response("", { status: 200 });
    }) as typeof fetch;

    const { callId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });
    // `calls.start` schedules the mobile ring; drain that background dispatch
    // before measuring, then invoke the action explicitly for a deterministic
    // count (mirrors the dispatchMobileForMessage test).
    await t.finishAllScheduledFunctions(() => {});
    bodies.length = 0;
    const result = await t.action(internal.notifications.dispatchMobileCallRinging, { callId });

    expect(result).toEqual({ sent: 1 });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.platform).toBe("ios");
    expect(bodies[0]?.token).toBe("apns-token");
    expect(bodies[0]?.messageId).toBe(callId);
    expect(bodies[0]?.channelId).toBe(channelId);
  });
});
