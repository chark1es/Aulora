import { Permission } from "@aulora/core";
import { decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { readSfuConfig, SFU_TOKEN_TTL_SECONDS, sfuRoomName, signSfuToken } from "../convex/lib/sfu";
import { EVERYONE_BASE, newTest, seedChannel, seedWorkspace } from "./helpers";

const ENV = {
  LIVEKIT_URL: "wss://stream.example.com",
  LIVEKIT_API_KEY: "APIkey123",
  LIVEKIT_API_SECRET: "super-secret-value-that-is-long-enough-for-hs256",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

function stubStreamingEnv() {
  for (const [key, value] of Object.entries(ENV)) {
    vi.stubEnv(key, value);
  }
}

describe("readSfuConfig", () => {
  it("is null until every setting is present", () => {
    expect(readSfuConfig({})).toBeNull();
    expect(readSfuConfig({ ...ENV, LIVEKIT_API_SECRET: "  " })).toBeNull();
    expect(readSfuConfig({ ...ENV, LIVEKIT_URL: "" })).toBeNull();
  });

  it("rejects a URL that is not a websocket origin", () => {
    expect(readSfuConfig({ ...ENV, LIVEKIT_URL: "https://stream.example.com" })).toBeNull();
    expect(readSfuConfig(ENV)).toEqual({
      url: ENV.LIVEKIT_URL,
      apiKey: ENV.LIVEKIT_API_KEY,
      apiSecret: ENV.LIVEKIT_API_SECRET,
    });
  });
});

describe("signSfuToken", () => {
  const config = {
    url: ENV.LIVEKIT_URL,
    apiKey: ENV.LIVEKIT_API_KEY,
    apiSecret: ENV.LIVEKIT_API_SECRET,
  };

  it("signs an HS256 token a LiveKit server can verify", async () => {
    const token = await signSfuToken({
      config,
      callId: "abc",
      identity: "user-1",
      canPublish: true,
      now: 1_700_000_000,
    });
    expect(decodeProtectedHeader(token).alg).toBe("HS256");
    const { payload } = await jwtVerify(token, new TextEncoder().encode(config.apiSecret), {
      issuer: config.apiKey,
      currentDate: new Date(1_700_000_100 * 1000),
    });
    expect(payload.sub).toBe("user-1");
    expect(payload.nbf).toBe(1_700_000_000);
    expect(payload.exp).toBe(1_700_000_000 + SFU_TOKEN_TTL_SECONDS);
  });

  it("scopes the grant to one room and to screen capture sources", async () => {
    const token = await signSfuToken({ config, callId: "abc", identity: "u", canPublish: true });
    const video = decodeJwt(token).video as Record<string, unknown>;
    expect(video.room).toBe(sfuRoomName("abc"));
    expect(video.roomJoin).toBe(true);
    expect(video.canSubscribe).toBe(true);
    expect(video.canPublish).toBe(true);
    expect(video.canPublishData).toBe(false);
    expect(video.canPublishSources).toEqual(["screen_share", "screen_share_audio"]);
  });

  it("gives a viewer no publish rights at all", async () => {
    const token = await signSfuToken({ config, callId: "abc", identity: "u", canPublish: false });
    const video = decodeJwt(token).video as Record<string, unknown>;
    expect(video.canPublish).toBe(false);
    expect(video.canPublishSources).toBeUndefined();
  });

  it("is rejected when verified with a different secret", async () => {
    const token = await signSfuToken({ config, callId: "abc", identity: "u", canPublish: true });
    await expect(
      jwtVerify(token, new TextEncoder().encode("a-different-secret-of-similar-length-xx")),
    ).rejects.toThrow();
  });
});

async function seedCall(options: { everyone?: bigint } = {}) {
  const t = newTest();
  await seedWorkspace(t, {
    members: [{ userId: "user-1" }, { userId: "user-2" }],
    ...(options.everyone !== undefined ? { everyonePermissions: options.everyone } : {}),
  });
  const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
  const { callId } = await t
    .withIdentity({ subject: "user-1" })
    .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a1" });
  return { t, channelId, callId };
}

describe("callStreaming.access", () => {
  it("returns null when no streaming server is configured", async () => {
    const { t, callId } = await seedCall();
    const result = await t
      .withIdentity({ subject: "user-1" })
      .action(api.callStreaming.access, { callId, clientId: "device-a1" });
    expect(result).toBeNull();
  });

  it("hands a participant a token for this call's room", async () => {
    stubStreamingEnv();
    const { t, callId } = await seedCall();
    const result = await t
      .withIdentity({ subject: "user-1" })
      .action(api.callStreaming.access, { callId, clientId: "device-a1" });
    expect(result?.url).toBe(ENV.LIVEKIT_URL);
    expect(result?.canPublish).toBe(true);
    const claims = decodeJwt(result?.token ?? "");
    expect(claims.sub).toBe("user-1");
    expect((claims.video as { room: string }).room).toBe(sfuRoomName(callId));
  });

  it("withholds publish rights from a member who may not stream", async () => {
    stubStreamingEnv();
    const { t, callId } = await seedCall({ everyone: EVERYONE_BASE & ~Permission.Stream });
    const result = await t
      .withIdentity({ subject: "user-1" })
      .action(api.callStreaming.access, { callId, clientId: "device-a1" });
    expect(result?.canPublish).toBe(false);
    expect((decodeJwt(result?.token ?? "").video as { canPublish: boolean }).canPublish).toBe(
      false,
    );
  });

  it("refuses someone who has not joined the call", async () => {
    stubStreamingEnv();
    const { t, callId } = await seedCall();
    await expect(
      t
        .withIdentity({ subject: "user-2" })
        .action(api.callStreaming.access, { callId, clientId: "device-b1" }),
    ).rejects.toThrow(/not in this call/);
  });

  it("refuses a different device than the one holding the seat", async () => {
    stubStreamingEnv();
    const { t, callId } = await seedCall();
    await expect(
      t
        .withIdentity({ subject: "user-1" })
        .action(api.callStreaming.access, { callId, clientId: "device-zz9" }),
    ).rejects.toThrow(/not in this call/);
  });

  it("refuses an unauthenticated caller", async () => {
    stubStreamingEnv();
    const { t, callId } = await seedCall();
    await expect(
      t.action(api.callStreaming.access, { callId, clientId: "device-a1" }),
    ).rejects.toThrow(/Not authenticated/);
  });
});

describe("calls.updateParticipant sfu flag", () => {
  it("records and exposes whether a device can use the streaming server", async () => {
    const { t, channelId, callId } = await seedCall();
    const asUser = t.withIdentity({ subject: "user-1" });
    const before = await asUser.query(api.calls.forChannel, { channelId });
    expect(before?.participants[0]?.sfu).toBe(false);

    await asUser.mutation(api.calls.updateParticipant, {
      callId,
      clientId: "device-a1",
      sfu: true,
    });
    const after = await asUser.query(api.calls.forChannel, { channelId });
    expect(after?.participants[0]?.sfu).toBe(true);
  });
});
