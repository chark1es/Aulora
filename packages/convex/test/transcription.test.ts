import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Permission } from "@aulora/core";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { audioTokenKey, mintAudioToken, verifyAudioToken } from "../convex/lib/transcriptionToken";
import { summarize as summarizeAction } from "../convex/transcriptionActions";
import { newTest, seedChannel, seedWorkspace, type Test } from "./helpers";

interface AudioTokenFixture {
  readonly secret: string;
  readonly claims: {
    readonly sid: string;
    readonly cid: string;
    readonly sub: string;
    readonly start: number;
    readonly iat: number;
    readonly exp: number;
  };
  readonly token: string;
}

async function patchSettings(t: Test, settings: Record<string, unknown>) {
  await t.run(async (ctx) => {
    const server = await ctx.db.query("server").first();
    if (server !== null) {
      await ctx.db.patch(server._id, { settings: { ...server.settings, ...settings } });
    }
  });
}

async function readyConfig(t: Test) {
  process.env.TRANSCRIBER_TOKEN = "test-transcriber-token";
  await t.run(async (ctx) => {
    await ctx.db.insert("transcriptionConfig", {
      modelId: "parakeet-tdt-0.6b-v3",
      modelStatus: "ready",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4o-mini",
      retentionDays: 30,
      allowPrivateEndpoint: false,
      updatedAt: Date.now(),
      updatedBy: "owner-1",
    });
    const service = await ctx.db.query("transcriberStatus").first();
    if (service === null) {
      await ctx.db.insert("transcriberStatus", {
        key: "service",
        serviceSeenAt: Date.now(),
        runtimeReady: true,
        runtimeModelId: "parakeet-tdt-0.6b-v3",
      });
    }
  });
}

const TRANSCRIBER_PERMISSION = Permission.StartTranscription;
const VIEW = Permission.ViewTranscripts;
const MANAGE = Permission.ManageTranscription;

async function seedCall(t: Test, userId = "user-1") {
  const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
  const { callId } = await t
    .withIdentity({ subject: userId })
    .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });
  return { channelId, callId };
}

describe("transcription permissions and start", () => {
  it("is off until the addon is enabled and a model is ready", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1", roleIds: ["voice-host"] }],
      extraRoles: [{ key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 }],
    });
    const { callId } = await seedCall(t);

    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.transcription.start, { callId }),
    ).rejects.toThrow(/Transcription is disabled/);

    await patchSettings(t, { transcriptionEnabled: true });
    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.transcription.start, { callId }),
    ).rejects.toThrow(/Download a speech model/);

    await readyConfig(t);
    const started = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.transcription.start, { callId });
    expect(started.sessionId).toBeDefined();

    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.transcription.start, { callId }),
    ).rejects.toThrow(/already running/);
  });

  it("denies a member without StartTranscription and requires being in the call", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1" }, { userId: "user-2" }],
    });
    await patchSettings(t, { transcriptionEnabled: true });
    await readyConfig(t);
    const { callId } = await seedCall(t);

    await expect(
      t.withIdentity({ subject: "user-2" }).mutation(api.transcription.start, { callId }),
    ).rejects.toThrow(/Missing permission/);
  });

  it("mints a token bound to the caller and session, and rejects a forged one", async () => {
    const previous = process.env.TRANSCRIBER_TOKEN;
    process.env.TRANSCRIBER_TOKEN = "test-transcriber-token";
    try {
      const t = newTest();
      await seedWorkspace(t, {
        members: [{ userId: "user-1", roleIds: ["voice-host"] }],
        extraRoles: [{ key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 }],
      });
      await patchSettings(t, { transcriptionEnabled: true });
      await readyConfig(t);
      const { callId } = await seedCall(t);
      const { sessionId } = await t
        .withIdentity({ subject: "user-1" })
        .mutation(api.transcription.start, { callId });

      const minted = await t
        .withIdentity({ subject: "user-1" })
        .mutation(api.transcription.mintAudioTokenForCall, { sessionId });
      const claims = await verifyAudioToken("test-transcriber-token", minted.token);
      expect(claims?.sid).toBe(sessionId);
      expect(claims?.sub).toBe("user:user-1");
      expect(claims?.cid).toBe(callId);
      const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
      expect(claims?.start).toBe(session?.startedAt);

      expect(await verifyAudioToken("wrong-secret", minted.token)).toBeNull();
    } finally {
      if (previous === undefined) {
        delete process.env.TRANSCRIBER_TOKEN;
      } else {
        process.env.TRANSCRIBER_TOKEN = previous;
      }
    }
  });
});

describe("audio token wire format", () => {
  const fixture = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          "../../../infra/transcriber/test/fixtures/audio-token-vector.json",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  ) as AudioTokenFixture;

  it("matches the shared cross-language fixed vector exactly", async () => {
    const minted = await mintAudioToken(fixture.secret, {
      sid: fixture.claims.sid,
      cid: fixture.claims.cid,
      sub: fixture.claims.sub,
      start: fixture.claims.start,
      now: fixture.claims.iat * 1000,
      ttlSeconds: fixture.claims.exp - fixture.claims.iat,
    });
    expect(minted.token).toBe(fixture.token);
    const claims = await verifyAudioToken(
      fixture.secret,
      fixture.token,
      (fixture.claims.iat + 1) * 1000,
    );
    expect(claims).toMatchObject(fixture.claims);
  });

  it("signs the base64url payload text, not the decoded JSON bytes", async () => {
    const [payload, signature] = fixture.token.split(".");
    const key = await audioTokenKey(fixture.secret);
    const encoder = new TextEncoder();
    const normalized = (signature ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const signatureBytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    const overText = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      encoder.encode(payload),
    );
    const overJson = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      encoder.encode(
        JSON.stringify({
          sid: fixture.claims.sid,
          cid: fixture.claims.cid,
          sub: fixture.claims.sub,
          start: fixture.claims.start,
          iat: fixture.claims.iat,
          exp: fixture.claims.exp,
        }),
      ),
    );
    expect(overText).toBe(true);
    expect(overJson).toBe(false);
  });
});

describe("transcription service availability", () => {
  it("requires an identity for the addon status query", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    await expect(t.query(api.addons.status, {})).rejects.toThrow(/Not authenticated/);
  });

  it("refuses to start unless the transcriber has reported recently", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1", roleIds: ["voice-host"] }],
      extraRoles: [{ key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 }],
    });
    await patchSettings(t, { transcriptionEnabled: true });
    await readyConfig(t);
    const { callId } = await seedCall(t);
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("transcriberStatus").take(10);
      for (const row of rows) await ctx.db.delete(row._id);
    });
    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.transcription.start, { callId }),
    ).rejects.toThrow(/service is not running/);
    await t.mutation(internal.transcription.recordServiceHello, {
      loadedModelId: "parakeet-tdt-0.6b-v3",
      loadedStatus: "ready",
    });
    const started = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.transcription.start, { callId });
    expect(started.sessionId).toBeDefined();
  });

  it("requires fresh runtime readiness even when the selected model is ready", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1", roleIds: ["voice-host"] }],
      extraRoles: [{ key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 }],
    });
    await patchSettings(t, { transcriptionEnabled: true });
    await readyConfig(t);
    const { callId } = await seedCall(t);

    // A restarted/empty container reports not_installed even though the
    // owner's stored selection still says ready.
    await t.mutation(internal.transcription.recordServiceHello, {
      loadedStatus: "not_installed",
    });
    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.transcription.start, { callId }),
    ).rejects.toThrow(/no model loaded/);
    const status = await t.withIdentity({ subject: "user-1" }).query(api.transcription.status, {});
    expect(status.serviceInstalled).toBe(true);
    expect(status.runtimeReady).toBe(false);
    const addons = await t.withIdentity({ subject: "user-1" }).query(api.addons.status, {});
    expect(addons.transcriptionModel.runtimeReady).toBe(false);

    await t.mutation(internal.transcription.recordServiceHello, {
      loadedModelId: "parakeet-tdt-0.6b-v3",
      loadedStatus: "ready",
    });
    const started = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.transcription.start, { callId });
    expect(started.sessionId).toBeDefined();
    const ready = await t.withIdentity({ subject: "user-1" }).query(api.transcription.status, {});
    expect(ready.runtimeReady).toBe(true);
  });

  it("re-syncs a fresh or legacy config and repairs the loaded model's error", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    await patchSettings(t, { transcriptionEnabled: true });
    await readyConfig(t);
    const readConfig = async () =>
      await t.run(async (ctx) => await ctx.db.query("transcriptionConfig").first());
    // A fresh not_installed config adopts the loaded model.
    await t.run(async (ctx) => {
      const row = await ctx.db.query("transcriptionConfig").first();
      if (row !== null) {
        await ctx.db.patch(row._id, { modelStatus: "not_installed", modelProgress: undefined });
      }
    });
    await t.mutation(internal.transcription.recordServiceHello, {
      loadedModelId: "parakeet-tdt-0.6b-v3",
      loadedStatus: "ready",
    });
    let config = await readConfig();
    expect(config?.modelId).toBe("parakeet-tdt-0.6b-v3");
    expect(config?.modelStatus).toBe("ready");

    await t.mutation(internal.transcription.recordServiceHello, {
      loadedModelId: "parakeet-tdt-0.6b-v3",
      loadedStatus: "ready",
      loadedError: "download failed earlier",
    });
    config = await readConfig();
    expect(config?.modelStatus).toBe("ready");
    expect(config?.modelError).toContain("failed earlier");

    // A later healthy heartbeat clears the stale download failure.
    await t.mutation(internal.transcription.recordServiceHello, {
      loadedModelId: "parakeet-tdt-0.6b-v3",
      loadedStatus: "ready",
    });
    config = await readConfig();
    expect(config?.modelError).toBeUndefined();
  });

  it("treats a legacy whisper model id as not installed and adopts a loaded parakeet", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1", roleIds: ["voice-host"] }],
      extraRoles: [{ key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 }],
    });
    await patchSettings(t, { transcriptionEnabled: true });
    await readyConfig(t);
    const { callId } = await seedCall(t);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("transcriptionConfig").first();
      if (row !== null) {
        await ctx.db.patch(row._id, { modelId: "large-v3-turbo", modelStatus: "ready" });
      }
    });
    const asUser = t.withIdentity({ subject: "user-1" });
    const status = await asUser.query(api.transcription.status, {});
    expect(status.ready).toBe(false);
    expect(status.modelStatus).toBe("not_installed");
    expect(status.modelId).toBe("parakeet-tdt-0.6b-v3");
    const addons = await asUser.query(api.addons.status, {});
    expect(addons.transcriptionModel.status).toBe("not_installed");
    await expect(asUser.mutation(api.transcription.start, { callId })).rejects.toThrow(
      /Download a speech model/,
    );

    await t.mutation(internal.transcription.recordServiceHello, {
      loadedModelId: "parakeet-tdt-0.6b-v3",
      loadedStatus: "ready",
    });
    const config = await t.run(async (ctx) => await ctx.db.query("transcriptionConfig").first());
    expect(config?.modelId).toBe("parakeet-tdt-0.6b-v3");
    expect(config?.modelStatus).toBe("ready");
    expect((await asUser.query(api.transcription.status, {})).ready).toBe(true);
  });

  it("reports whether the transcriber is installed to members and managers", async () => {
    const previous = process.env.TRANSCRIBER_TOKEN;
    try {
      const t = newTest();
      await seedWorkspace(t, {
        members: [{ userId: "user-1", roleIds: ["config"] }],
        extraRoles: [{ key: "config", permissions: MANAGE, position: 2 }],
      });
      delete process.env.TRANSCRIBER_TOKEN;
      const asUser = t.withIdentity({ subject: "user-1" });
      expect((await asUser.query(api.transcription.status, {})).serviceInstalled).toBe(false);
      expect((await asUser.query(api.transcription.getConfig, {})).serviceInstalled).toBe(false);

      // Setup always generates the secret, so the secret alone is not proof the
      // optional container is running.
      process.env.TRANSCRIBER_TOKEN = "test-transcriber-token";
      expect((await asUser.query(api.transcription.status, {})).serviceInstalled).toBe(false);

      await t.mutation(internal.transcription.recordServiceHello, {});
      expect((await asUser.query(api.transcription.status, {})).serviceInstalled).toBe(true);
      const config = await asUser.query(api.transcription.getConfig, {});
      expect(config.serviceInstalled).toBe(true);
      // The shared secret itself is never part of any response.
      expect(JSON.stringify(config)).not.toContain("test-transcriber-token");

      // A stopped container goes stale within the three-minute window.
      await t.run(async (ctx) => {
        const row = await ctx.db.query("transcriberStatus").first();
        if (row !== null) {
          await ctx.db.patch(row._id, { serviceSeenAt: Date.now() - 4 * 60_000 });
        }
      });
      expect((await asUser.query(api.transcription.status, {})).serviceInstalled).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.TRANSCRIBER_TOKEN;
      } else {
        process.env.TRANSCRIBER_TOKEN = previous;
      }
    }
  });
});

describe("transcription ingest and read gating", () => {
  async function startedSession(t: Test) {
    await patchSettings(t, { transcriptionEnabled: true });
    await readyConfig(t);
    const { callId } = await seedCall(t);
    const { sessionId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.transcription.start, { callId });
    return { callId, sessionId };
  }

  it("accepts only segments from a participant in an active session", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1", roleIds: ["voice-host"] }],
      extraRoles: [{ key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 }],
    });
    const { sessionId } = await startedSession(t);

    await expect(
      t.mutation(internal.transcription.ingestSegments, {
        sessionId,
        speakerKey: "user:user-2",
        segments: [{ seq: 1, startMs: 0, endMs: 1000, text: "hello" }],
      }),
    ).rejects.toThrow(/not in this call/);

    const result = await t.mutation(internal.transcription.ingestSegments, {
      sessionId,
      speakerKey: "user:user-1",
      segments: [
        { seq: 1, startMs: 0, endMs: 1000, text: "  hello there  " },
        { seq: 2, startMs: 1200, endMs: 2000, text: "second line" },
      ],
    });
    expect(result.accepted).toBe(2);

    await expect(
      t.mutation(internal.transcription.ingestSegments, {
        sessionId,
        speakerKey: "user:user-1",
        segments: [{ seq: 1, startMs: 0, endMs: 1000, text: "out of order" }],
      }),
    ).rejects.toThrow(/out of order/);
  });

  it("accepts a second speaker and a reconnect, and orders by session-relative time", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [
        { userId: "user-1", roleIds: ["voice-host"] },
        { userId: "user-2", roleIds: ["voice-host"] },
        { userId: "reader", roleIds: ["reader"] },
      ],
      extraRoles: [
        { key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 },
        { key: "reader", permissions: VIEW, position: 1 },
      ],
    });
    await patchSettings(t, { transcriptionEnabled: true });
    await readyConfig(t);
    const { callId } = await seedCall(t);
    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.join, { callId, clientId: "device-b" });
    const { sessionId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.transcription.start, { callId });
    const session = await t.run(async (ctx) => await ctx.db.get(sessionId));

    // Both speakers start at seq 1; per-speaker replay state must not reject it.
    await t.mutation(internal.transcription.ingestSegments, {
      sessionId,
      speakerKey: "user:user-1",
      segments: [{ seq: 1, startMs: 0, endMs: 1000, text: "first" }],
    });
    await t.mutation(internal.transcription.ingestSegments, {
      sessionId,
      speakerKey: "user:user-2",
      segments: [{ seq: 1, startMs: 500, endMs: 1500, text: "second" }],
    });
    await t.mutation(internal.transcription.ingestSegments, {
      sessionId,
      speakerKey: "user:user-1",
      segments: [{ seq: 2, startMs: 2000, endMs: 3000, text: "third" }],
    });
    // A reconnect restarts seq at 1 but its clock keeps moving; accept it.
    await t.mutation(internal.transcription.ingestSegments, {
      sessionId,
      speakerKey: "user:user-1",
      segments: [{ seq: 1, startMs: 5000, endMs: 6000, text: "reconnected" }],
    });
    // Replaying old audio with an old clock is still rejected.
    await expect(
      t.mutation(internal.transcription.ingestSegments, {
        sessionId,
        speakerKey: "user:user-1",
        segments: [{ seq: 1, startMs: 0, endMs: 1000, text: "replay" }],
      }),
    ).rejects.toThrow(/out of order/);

    const reader = t.withIdentity({ subject: "reader" });
    const firstPage = await reader.query(api.transcription.listSegments, { sessionId });
    expect(firstPage.page.map((segment) => segment.text)).toEqual([
      "first",
      "second",
      "third",
      "reconnected",
    ]);
    expect(firstPage.page.map((segment) => segment.startMs)).toEqual([0, 500, 2000, 5000]);
    expect(firstPage.nextCursor).toBeNull();
    expect(session?.startedAt).toBeGreaterThan(0);
  });

  it("accepts a late but new batch and rejects an exact replay or an overlap", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [
        { userId: "user-1", roleIds: ["voice-host"] },
        { userId: "reader", roleIds: ["reader"] },
      ],
      extraRoles: [
        { key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 },
        { key: "reader", permissions: VIEW, position: 1 },
      ],
    });
    const { sessionId } = await startedSession(t);
    const speakerKey = "user:user-1";

    // The replacement's newer batch lands first, as when an evicted socket's
    // teardown drain is delayed past the replacement's first POST.
    await t.mutation(internal.transcription.ingestSegments, {
      sessionId,
      speakerKey,
      segments: [{ seq: 2, startMs: 2000, endMs: 3000, text: "later batch" }],
    });
    const late = await t.mutation(internal.transcription.ingestSegments, {
      sessionId,
      speakerKey,
      segments: [{ seq: 1, startMs: 0, endMs: 1000, text: "late drain" }],
    });
    expect(late.accepted).toBe(1);

    // The exact same sequence is still a replay, even with the same range.
    await expect(
      t.mutation(internal.transcription.ingestSegments, {
        sessionId,
        speakerKey,
        segments: [{ seq: 1, startMs: 0, endMs: 1000, text: "replay" }],
      }),
    ).rejects.toThrow(/out of order/);

    // A never-stored lower seq that overlaps stored audio is not safe either.
    await t.mutation(internal.transcription.ingestSegments, {
      sessionId,
      speakerKey,
      segments: [{ seq: 4, startMs: 4000, endMs: 5000, text: "fourth" }],
    });
    await expect(
      t.mutation(internal.transcription.ingestSegments, {
        sessionId,
        speakerKey,
        segments: [{ seq: 3, startMs: 2500, endMs: 3500, text: "overlaps" }],
      }),
    ).rejects.toThrow(/out of order/);

    const page = await t
      .withIdentity({ subject: "reader" })
      .query(api.transcription.listSegments, { sessionId });
    expect(page.page.map((segment) => segment.text)).toEqual([
      "late drain",
      "later batch",
      "fourth",
    ]);
  });

  it("keeps sequence state as a high-water mark so a replay cannot lower it", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [
        { userId: "user-1", roleIds: ["voice-host"] },
        { userId: "reader", roleIds: ["reader"] },
      ],
      extraRoles: [
        { key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 },
        { key: "reader", permissions: VIEW, position: 1 },
      ],
    });
    const { sessionId } = await startedSession(t);
    const speakerKey = "user:user-1";
    const ingest = (segments: { seq: number; startMs: number; endMs: number; text: string }[]) =>
      t.mutation(internal.transcription.ingestSegments, { sessionId, speakerKey, segments });

    await ingest([{ seq: 10, startMs: 0, endMs: 2000, text: "original" }]);
    // A restart-shaped seq 1 that overlaps the stored audio is not new audio.
    await expect(ingest([{ seq: 1, startMs: 1000, endMs: 2500, text: "overlap" }])).rejects.toThrow(
      /out of order/,
    );
    // Re-posting the original batch is still an exact replay, not a fresh
    // restart: the stored state never moved backwards.
    await expect(ingest([{ seq: 10, startMs: 0, endMs: 2000, text: "original" }])).rejects.toThrow(
      /out of order/,
    );

    const page = await t
      .withIdentity({ subject: "reader" })
      .query(api.transcription.listSegments, { sessionId });
    expect(page.page.map((segment) => segment.text)).toEqual(["original"]);
  });

  it("accepts a genuine transcriber restart after the stored high-water mark", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [
        { userId: "user-1", roleIds: ["voice-host"] },
        { userId: "reader", roleIds: ["reader"] },
      ],
      extraRoles: [
        { key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 },
        { key: "reader", permissions: VIEW, position: 1 },
      ],
    });
    const { sessionId } = await startedSession(t);
    const speakerKey = "user:user-1";
    const ingest = (segments: { seq: number; startMs: number; endMs: number; text: string }[]) =>
      t.mutation(internal.transcription.ingestSegments, { sessionId, speakerKey, segments });

    await ingest([{ seq: 10, startMs: 0, endMs: 2000, text: "before" }]);
    // The process restarted: the counter is back at 1 and the clock moved
    // forward, so this is new audio even though seq 10 is already stored.
    expect((await ingest([{ seq: 1, startMs: 3000, endMs: 4000, text: "after" }])).accepted).toBe(
      1,
    );
    // The restarted stream continues at seq 2, still below the old high-water
    // sequence; contiguous windows are not duplicates.
    expect(
      (await ingest([{ seq: 2, startMs: 4000, endMs: 5000, text: "continues" }])).accepted,
    ).toBe(1);
    // J1's late-but-new path still works inside the gap.
    expect((await ingest([{ seq: 5, startMs: 2200, endMs: 2800, text: "gap" }])).accepted).toBe(1);
    // Replaying the restarted window is still rejected.
    await expect(ingest([{ seq: 1, startMs: 3000, endMs: 4000, text: "after" }])).rejects.toThrow(
      /out of order/,
    );

    const page = await t
      .withIdentity({ subject: "reader" })
      .query(api.transcription.listSegments, { sessionId });
    expect(page.page.map((segment) => segment.text)).toEqual([
      "before",
      "gap",
      "after",
      "continues",
    ]);
  });

  it("pages by a stable index cursor with ties and no re-reads", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [
        { userId: "user-1", roleIds: ["voice-host"] },
        { userId: "user-2", roleIds: ["voice-host"] },
        { userId: "reader", roleIds: ["reader"] },
      ],
      extraRoles: [
        { key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 },
        { key: "reader", permissions: VIEW, position: 1 },
      ],
    });
    await patchSettings(t, { transcriptionEnabled: true });
    await readyConfig(t);
    const { callId } = await seedCall(t);
    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.join, { callId, clientId: "device-b" });
    const { sessionId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.transcription.start, { callId });

    // Two speakers share every startMs, so the tie-break is exercised.
    for (const speakerKey of ["user:user-1", "user:user-2"]) {
      for (const [from, count] of [
        [1, 50],
        [51, 30],
      ] as const) {
        await t.mutation(internal.transcription.ingestSegments, {
          sessionId,
          speakerKey,
          segments: Array.from({ length: count }, (_, index) => {
            const seq = from + index;
            return {
              seq,
              startMs: (seq - 1) * 1000,
              endMs: (seq - 1) * 1000 + 800,
              text: `${speakerKey}-${seq}`,
            };
          }),
        });
      }
    }

    const reader = t.withIdentity({ subject: "reader" });
    const first = await reader.query(api.transcription.listSegments, { sessionId });
    expect(first.page).toHaveLength(100);
    expect(first.nextCursor).not.toBeNull();
    const firstIds = new Set(first.page.map((segment) => segment.id));

    // Insert an earlier-starting segment after the cursor exists; the next page
    // must not re-read rows the client already has.
    await t.mutation(internal.transcription.ingestSegments, {
      sessionId,
      speakerKey: "user:user-1",
      segments: [{ seq: 81, startMs: 0, endMs: 500, text: "late-early" }],
    });
    const second = await reader.query(api.transcription.listSegments, {
      sessionId,
      ...(first.nextCursor !== null ? { cursor: first.nextCursor } : {}),
    });
    expect(second.page.length).toBeGreaterThan(0);
    expect(second.page.some((segment) => firstIds.has(segment.id))).toBe(false);
    expect(second.page.some((segment) => segment.text === "late-early")).toBe(false);
    expect(second.nextCursor).toBeNull();
    expect(first.page.length + second.page.length).toBe(160);
  });

  it("needs ViewTranscripts for reads and opens sealed text", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [
        { userId: "user-1", roleIds: ["voice-host"] },
        { userId: "reader", roleIds: ["reader"] },
      ],
      extraRoles: [
        { key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 },
        { key: "reader", permissions: VIEW, position: 1 },
      ],
    });
    const { sessionId } = await startedSession(t);
    await t.mutation(internal.transcription.ingestSegments, {
      sessionId,
      speakerKey: "user:user-1",
      segments: [{ seq: 1, startMs: 0, endMs: 1000, text: "hello there" }],
    });

    const page = await t
      .withIdentity({ subject: "reader" })
      .query(api.transcription.listSegments, { sessionId });
    expect(page.page.map((segment) => segment.text)).toEqual(["hello there"]);
    expect(page.page[0]?.speakerName).toBeTruthy();
    expect(page.nextCursor).toBeNull();

    await expect(
      t.withIdentity({ subject: "user-1" }).query(api.transcription.listSegments, { sessionId }),
    ).rejects.toThrow(/Missing transcript permission/);

    await expect(
      t
        .withIdentity({ subject: "reader" })
        .mutation(api.transcription.deleteSession, { sessionId }),
    ).rejects.toThrow(/Missing permission/);
  });

  it("ends the session with the call and purges it after retention", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1", roleIds: ["voice-host"] }],
      extraRoles: [{ key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 }],
    });
    const { callId, sessionId } = await startedSession(t);
    await t.withIdentity({ subject: "user-1" }).mutation(api.calls.end, { callId });
    let ended = await t.run(async (ctx) => await ctx.db.get(sessionId));
    // The call end opens the same bounded finalization window as `stop`.
    expect(ended?.status).toBe("ending");
    await t.run(async (ctx) => {
      if (ended !== null) await ctx.db.patch(ended._id, { endsAt: Date.now() - 1 });
    });
    await t.mutation(internal.transcription.finalizeSession, { sessionId });
    ended = await t.run(async (ctx) => await ctx.db.get(sessionId));
    expect(ended?.status).toBe("ended");

    await t.run(async (ctx) => {
      if (ended !== null) {
        await ctx.db.patch(ended._id, { retentionExpiresAt: Date.now() - 1 });
      }
    });
    await t.mutation(internal.transcription.purgeExpired, {});
    expect(await t.run(async (ctx) => await ctx.db.get(sessionId))).toBeNull();
  });

  it("deletes per-speaker replay state with the session's segments", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1", roleIds: ["voice-host"] }],
      extraRoles: [{ key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 }],
    });
    const { sessionId } = await startedSession(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("transcriptSpeakerState", {
        sessionId,
        speakerKey: "user:user-1",
        lastSeq: 1,
        lastStartMs: 0,
        segmentCount: 1,
        updatedAt: Date.now(),
      });
    });
    await t.mutation(internal.transcriptionCleanup.deleteSegments, { sessionId });
    expect(
      await t.run(async (ctx) => await ctx.db.query("transcriptSpeakerState").first()),
    ).toBeNull();
  });

  it("purges only sessions with an elapsed expiry, never an active or keep-forever one", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1", roleIds: ["voice-host"] }],
      extraRoles: [{ key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 }],
    });
    const { sessionId: activeId } = await startedSession(t);
    const { endedId, keptId } = await t.run(async (ctx) => {
      const call = await ctx.db.query("calls").first();
      if (call === null) throw new Error("seed call missing");
      const endedId = await ctx.db.insert("transcriptionSessions", {
        callId: call._id,
        startedBy: "user-1",
        startedAt: Date.now() - 1000,
        endedAt: Date.now() - 1000,
        status: "ended",
        summaryStatus: "none",
        segmentCount: 0,
        lastSeq: 0,
        retentionExpiresAt: Date.now() - 1,
      });
      const keptId = await ctx.db.insert("transcriptionSessions", {
        callId: call._id,
        startedBy: "user-1",
        startedAt: Date.now() - 1000,
        endedAt: Date.now() - 1000,
        status: "ended",
        summaryStatus: "none",
        segmentCount: 0,
        lastSeq: 0,
      });
      return { endedId, keptId };
    });
    await t.mutation(internal.transcription.purgeExpired, {});
    expect(await t.run(async (ctx) => await ctx.db.get(activeId))).not.toBeNull();
    expect(await t.run(async (ctx) => await ctx.db.get(keptId))).not.toBeNull();
    expect(await t.run(async (ctx) => await ctx.db.get(endedId))).toBeNull();
  });
});

describe("transcription finalization window", () => {
  async function startFinalizingSession(t: Test, options: { withKey?: boolean } = {}) {
    await seedWorkspace(t, {
      members: [{ userId: "user-1", roleIds: ["voice-host"] }],
      extraRoles: [{ key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 }],
    });
    await patchSettings(t, { transcriptionEnabled: true });
    await readyConfig(t);
    if (options.withKey === true) {
      await t.withIdentity({ subject: "owner-1" }).mutation(api.transcription.updateConfig, {
        baseUrl: "https://summary.example.com/v1",
        apiKey: "sk-synthetic-summary-key",
        model: "test-model",
      });
    }
    const { callId } = await seedCall(t);
    const { sessionId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.transcription.start, { callId });
    return { callId, sessionId };
  }

  it("keeps authorized final audio and queues the summary only after the grace", async () => {
    const t = newTest();
    const { callId, sessionId } = await startFinalizingSession(t, { withKey: true });
    // Minting the token records durable authorization for this speaker.
    await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.transcription.mintAudioTokenForCall, { sessionId });
    await t.withIdentity({ subject: "user-1" }).mutation(api.transcription.stop, { sessionId });
    let session = await t.run(async (ctx) => await ctx.db.get(sessionId));
    expect(session?.status).toBe("ending");
    expect(session?.summaryStatus).toBe("none");
    expect(session?.summaryAttemptId).toBeUndefined();
    expect(session?.endsAt).toBeGreaterThan(Date.now());

    // Leaving removes the seat and may end the call; the final drain still
    // belongs to a speaker authorized earlier in the session.
    await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.leave, { callId, clientId: "device-a" });
    await expect(
      t.mutation(internal.transcription.ingestSegments, {
        sessionId,
        speakerKey: "user:user-1",
        segments: [{ seq: 2, startMs: 999_999, endMs: 1_000_000, text: "after stop" }],
      }),
    ).rejects.toThrow(/after the session stopped/);
    const accepted = await t.mutation(internal.transcription.ingestSegments, {
      sessionId,
      speakerKey: "user:user-1",
      segments: [{ seq: 2, startMs: 0, endMs: 900, text: "final words" }],
    });
    expect(accepted.accepted).toBe(1);

    // Once the grace closes, ingest is rejected until the finalizer runs.
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { endsAt: Date.now() - 1 });
    });
    await expect(
      t.mutation(internal.transcription.ingestSegments, {
        sessionId,
        speakerKey: "user:user-1",
        segments: [{ seq: 3, startMs: 1_000, endMs: 1_900, text: "too late" }],
      }),
    ).rejects.toThrow(/finalization window has closed/);

    await t.mutation(internal.transcription.finalizeSession, { sessionId });
    session = await t.run(async (ctx) => await ctx.db.get(sessionId));
    expect(session?.status).toBe("ended");
    expect(session?.summaryStatus).toBe("pending");
    expect(session?.summaryAttemptId).toBeDefined();
    expect(session?.endsAt).toBeUndefined();
  });

  it("rejects a never-authorized speaker and a late audio token", async () => {
    const t = newTest();
    const { sessionId } = await startFinalizingSession(t);
    await t.withIdentity({ subject: "user-1" }).mutation(api.transcription.stop, { sessionId });
    await expect(
      t.mutation(internal.transcription.ingestSegments, {
        sessionId,
        speakerKey: "user:user-2",
        segments: [{ seq: 1, startMs: 0, endMs: 900, text: "stranger" }],
      }),
    ).rejects.toThrow(/Speaker is not in this call/);
    await expect(
      t
        .withIdentity({ subject: "user-1" })
        .mutation(api.transcription.mintAudioTokenForCall, { sessionId }),
    ).rejects.toThrow(/Transcription is not running/);
  });
});

describe("transcription speaker departure grace", () => {
  async function twoSpeakerSession(t: Test) {
    await seedWorkspace(t, {
      members: [
        { userId: "user-1", roleIds: ["voice-host"] },
        { userId: "user-2", roleIds: ["voice-host"] },
      ],
      extraRoles: [{ key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 }],
    });
    await patchSettings(t, { transcriptionEnabled: true });
    await readyConfig(t);
    const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
    const { callId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });
    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.join, { callId, clientId: "device-b" });
    const { sessionId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.transcription.start, { callId });
    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.transcription.mintAudioTokenForCall, { sessionId });
    return { callId, sessionId };
  }

  it("keeps a leaver's final drain, closes it after 30 s, and reopens on rejoin", async () => {
    const t = newTest();
    const { callId, sessionId } = await twoSpeakerSession(t);
    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.leave, { callId, clientId: "device-b" });

    const withinGrace = await t.mutation(internal.transcription.ingestSegments, {
      sessionId,
      speakerKey: "user:user-2",
      segments: [{ seq: 1, startMs: 0, endMs: 900, text: "walking out" }],
    });
    expect(withinGrace.accepted).toBe(1);

    await t.run(async (ctx) => {
      const states = await ctx.db.query("transcriptSpeakerState").take(64);
      const state =
        states.find((row) => row.sessionId === sessionId && row.speakerKey === "user:user-2") ??
        null;
      if (state !== null) {
        await ctx.db.patch(state._id, { leftAt: Date.now() - 31_000 });
      }
    });
    await expect(
      t.mutation(internal.transcription.ingestSegments, {
        sessionId,
        speakerKey: "user:user-2",
        segments: [{ seq: 2, startMs: 1_000, endMs: 1_900, text: "too late" }],
      }),
    ).rejects.toThrow(/speaker's finalization window has closed/);

    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.calls.join, { callId, clientId: "device-b" });
    const rejoined = await t.mutation(internal.transcription.ingestSegments, {
      sessionId,
      speakerKey: "user:user-2",
      segments: [{ seq: 2, startMs: 1_000, endMs: 1_900, text: "back again" }],
    });
    expect(rejoined.accepted).toBe(1);
  });

  it("records the departure from the stale-participant sweep", async () => {
    const t = newTest();
    const { callId, sessionId } = await twoSpeakerSession(t);
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("callParticipants").take(64);
      const row = rows.find((entry) => entry.callId === callId && entry.userId === "user-2");
      if (row !== undefined) {
        await ctx.db.patch(row._id, { lastSeen: Date.now() - 60_000 });
      }
    });
    await t.mutation(internal.calls.sweep, {});
    const accepted = await t.mutation(internal.transcription.ingestSegments, {
      sessionId,
      speakerKey: "user:user-2",
      segments: [{ seq: 1, startMs: 0, endMs: 900, text: "stale final" }],
    });
    expect(accepted.accepted).toBe(1);
  });

  it("rejects a moderator-removed guest immediately and a never-seated speaker", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1", roleIds: ["guest-host"] }],
      extraRoles: [
        {
          key: "guest-host",
          permissions:
            Permission.CreateGuestLinks | Permission.ManageGuestAccess | TRANSCRIBER_PERMISSION,
          position: 2,
        },
      ],
    });
    await patchSettings(t, { transcriptionEnabled: true, guestCallsEnabled: true });
    await readyConfig(t);
    const channelId = await seedChannel(t, { kind: "voice", name: "Guest lounge" });
    const { callId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });
    const link = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.guestCalls.createLink, { channelId, maxUses: 5 });
    const join = await t.mutation(api.guestCalls.requestJoin, {
      token: link.token,
      displayName: "Guest",
      clientId: "guest-device-1",
    });
    await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.guestCalls.admit, { guestSessionId: join.guestSessionId });
    const { sessionId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.transcription.start, { callId });
    await t.mutation(api.guestCalls.mintAudioToken, { sessionToken: join.sessionToken });
    await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.guestCalls.remove, { guestSessionId: join.guestSessionId });

    await expect(
      t.mutation(internal.transcription.ingestSegments, {
        sessionId,
        speakerKey: `guest:${join.guestSessionId}`,
        segments: [{ seq: 1, startMs: 0, endMs: 900, text: "removed audio" }],
      }),
    ).rejects.toThrow(/Speaker was removed from this call/);
    await expect(
      t.mutation(internal.transcription.ingestSegments, {
        sessionId,
        speakerKey: "user:user-2",
        segments: [{ seq: 1, startMs: 0, endMs: 900, text: "stranger" }],
      }),
    ).rejects.toThrow(/Speaker is not in this call/);
  });
});

describe("disabling the transcription addon", () => {
  it("ends active sessions, rejects ingest, skips the queue and still allows stop", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1", roleIds: ["voice-host"] }],
      extraRoles: [{ key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 }],
    });
    await patchSettings(t, { transcriptionEnabled: true });
    await readyConfig(t);
    const { callId } = await seedCall(t);
    const { sessionId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.transcription.start, { callId });

    await t.withIdentity({ subject: "owner-1" }).mutation(api.addons.setEnabled, {
      addon: "transcription",
      enabled: false,
    });
    await t.finishAllScheduledFunctions(() => {});
    const ended = await t.run(async (ctx) => await ctx.db.get(sessionId));
    expect(ended?.status).toBe("ended");
    const call = await t.run(async (ctx) => await ctx.db.get(callId));
    expect(call?.transcriptionSessionId).toBeUndefined();

    await expect(
      t.mutation(internal.transcription.ingestSegments, {
        sessionId,
        speakerKey: "user:user-1",
        segments: [{ seq: 1, startMs: 0, endMs: 1000, text: "late" }],
      }),
    ).rejects.toThrow(/Transcription is disabled/);

    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { summaryStatus: "none" });
    });
    expect(await t.mutation(internal.transcription.sessionsNeedingSummary, {})).toBe(0);

    // A session left active while the addon is off can still be stopped.
    const manualId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("transcriptionSessions", {
        callId,
        startedBy: "user-1",
        startedAt: Date.now(),
        status: "active",
        summaryStatus: "none",
        segmentCount: 0,
        lastSeq: 0,
      });
      await ctx.db.patch(callId, { transcriptionSessionId: id, updatedAt: Date.now() });
      return id;
    });
    await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.transcription.stop, { sessionId: manualId });
    expect(await t.run(async (ctx) => (await ctx.db.get(manualId))?.status)).toBe("ending");
  });

  it("stops active sessions when updateSettings disables transcription", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1", roleIds: ["voice-host"] }],
      extraRoles: [{ key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 }],
    });
    await patchSettings(t, { transcriptionEnabled: true });
    await readyConfig(t);
    const { callId } = await seedCall(t);
    const { sessionId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.transcription.start, { callId });

    await t
      .withIdentity({ subject: "owner-1" })
      .mutation(api.server.updateSettings, { transcriptionEnabled: false });
    await t.finishAllScheduledFunctions(() => {});
    const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
    expect(session?.status).toBe("ended");
    expect(session?.summaryStatus).toBe("none");
    await expect(
      t.mutation(internal.transcription.ingestSegments, {
        sessionId,
        speakerKey: "user:user-1",
        segments: [{ seq: 1, startMs: 0, endMs: 900, text: "late" }],
      }),
    ).rejects.toThrow(/Transcription is disabled/);
  });

  it("never sends a transcript to the LLM while the addon is off", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1", roleIds: ["voice-host"] }],
      extraRoles: [{ key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 }],
    });
    await patchSettings(t, { transcriptionEnabled: true });
    await readyConfig(t);
    await t.withIdentity({ subject: "owner-1" }).mutation(api.transcription.updateConfig, {
      baseUrl: "https://summary.example.com/v1",
      apiKey: "sk-synthetic-summary-key",
      model: "test-model",
    });
    const { callId } = await seedCall(t);
    const sessionId = await t.run(async (ctx) =>
      ctx.db.insert("transcriptionSessions", {
        callId,
        startedBy: "user-1",
        startedAt: Date.now() - 1000,
        endedAt: Date.now() - 500,
        status: "ended",
        summaryStatus: "none",
        segmentCount: 0,
        lastSeq: 0,
      }),
    );
    await t.withIdentity({ subject: "owner-1" }).mutation(api.addons.setEnabled, {
      addon: "transcription",
      enabled: false,
    });
    await t.finishAllScheduledFunctions(() => {});

    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await t.action(internal.transcriptionActions.summarize, {
        sessionId,
        attemptId: SEED_ATTEMPT,
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await t.run(async (ctx) => (await ctx.db.get(sessionId))?.summaryStatus)).toBe("none");
  });
});

function summaryResponse(overview = "Summary"): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              overview,
              keyPoints: [],
              decisions: [],
              actionItems: [],
              speakerHighlights: [],
              language: null,
            }),
          },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function requestBodies(fetchSpy: ReturnType<typeof vi.fn>): string[] {
  return fetchSpy.mock.calls.map((call) =>
    String((call[1] as RequestInit | undefined)?.body ?? ""),
  );
}

const SEED_ATTEMPT = "attempt-seed";

async function seedPendingSession(
  t: Test,
  options: {
    readonly segments?: number;
    readonly textLength?: number;
    readonly active?: boolean;
  } = {},
) {
  await seedWorkspace(t, {
    members: [{ userId: "user-1", roleIds: ["voice-host"] }],
    extraRoles: [{ key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 }],
  });
  await patchSettings(t, { transcriptionEnabled: true });
  await readyConfig(t);
  await t.withIdentity({ subject: "owner-1" }).mutation(api.transcription.updateConfig, {
    baseUrl: "https://summary.example.com/v1",
    apiKey: "sk-synthetic-summary-key",
    model: "test-model",
  });
  const { callId } = await seedCall(t);
  const { sessionId } = await t
    .withIdentity({ subject: "user-1" })
    .mutation(api.transcription.start, { callId });
  const count = options.segments ?? 1;
  const length = options.textLength ?? 10;
  const segments = Array.from({ length: count }, (_, index) => ({
    seq: index + 1,
    startMs: index * 1000,
    endMs: index * 1000 + 900,
    text: "a".repeat(length),
  }));
  for (let start = 0; start < segments.length; start += 50) {
    await t.mutation(internal.transcription.ingestSegments, {
      sessionId,
      speakerKey: "user:user-1",
      segments: segments.slice(start, start + 50),
    });
  }
  if (options.active === true) {
    return { sessionId, callId };
  }
  await t.run(async (ctx) => {
    await ctx.db.patch(sessionId, {
      status: "ended",
      endedAt: Date.now(),
      summaryStatus: "pending",
      summaryRequestedAt: Date.now(),
      summaryAttemptId: SEED_ATTEMPT,
    });
  });
  return { sessionId, callId };
}

async function beginAttempt(t: Test, sessionId: Id<"transcriptionSessions">, attemptId: string) {
  await t.run(async (ctx) => {
    await ctx.db.patch(sessionId, {
      status: "ended",
      endedAt: Date.now(),
      summaryStatus: "pending",
      summaryRequestedAt: Date.now(),
      summaryAttemptId: attemptId,
      summaryError: undefined,
    });
  });
}

describe("summary run lifecycle", () => {
  it("keeps B ready when an older attempt A fails afterwards", async () => {
    const t = newTest();
    const { sessionId } = await seedPendingSession(t);
    let releaseA: () => void = () => {};
    const aGate = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let markStarted: () => void = () => {};
    const aStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fetchA = vi.fn(async () => {
      markStarted();
      await aGate;
      throw new Error("attempt A failed late");
    });
    await beginAttempt(t, sessionId, "attempt-a");
    vi.stubGlobal("fetch", fetchA);
    const aPromise = t.action(internal.transcriptionActions.summarize, {
      sessionId,
      attemptId: "attempt-a",
    });
    await aStarted;

    await beginAttempt(t, sessionId, "attempt-b");
    const fetchB = vi.fn(async () => summaryResponse("B summary"));
    vi.stubGlobal("fetch", fetchB);
    try {
      await t.action(internal.transcriptionActions.summarize, {
        sessionId,
        attemptId: "attempt-b",
      });
    } finally {
      releaseA();
      await aPromise;
      vi.unstubAllGlobals();
    }
    const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
    expect(fetchA).toHaveBeenCalledTimes(1);
    expect(fetchB).toHaveBeenCalledTimes(1);
    expect(session?.summaryStatus).toBe("ready");
    expect(session?.summaryError).toBeUndefined();
    expect(session?.summaryAttemptId).toBeUndefined();
  });

  it("does not let an older attempt abort reset a newer pending run", async () => {
    const t = newTest();
    const { sessionId } = await seedPendingSession(t);
    await beginAttempt(t, sessionId, "attempt-b");

    await t.mutation(internal.transcription.resetSummaryPending, {
      sessionId,
      attemptId: "attempt-a",
    });
    let session = await t.run(async (ctx) => await ctx.db.get(sessionId));
    expect(session?.summaryStatus).toBe("pending");
    expect(session?.summaryAttemptId).toBe("attempt-b");

    await t.withIdentity({ subject: "owner-1" }).mutation(api.addons.setEnabled, {
      addon: "transcription",
      enabled: false,
    });
    const fetchSpy = vi.fn(async () => summaryResponse());
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await t.action(internal.transcriptionActions.summarize, {
        sessionId,
        attemptId: "attempt-a",
      });
    } finally {
      vi.unstubAllGlobals();
    }
    session = await t.run(async (ctx) => await ctx.db.get(sessionId));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(session?.summaryStatus).toBe("pending");
    expect(session?.summaryAttemptId).toBe("attempt-b");
    await t.withIdentity({ subject: "owner-1" }).mutation(api.addons.setEnabled, {
      addon: "transcription",
      enabled: true,
    });
  });

  it("suppresses a duplicate request while a fresh attempt is pending", async () => {
    const t = newTest();
    const { sessionId } = await seedPendingSession(t);
    const before = await t.run(async (ctx) => await ctx.db.get(sessionId));
    await t
      .withIdentity({ subject: "owner-1" })
      .mutation(api.transcription.requestSummary, { sessionId });
    const after = await t.run(async (ctx) => await ctx.db.get(sessionId));
    expect(after?.summaryStatus).toBe("pending");
    expect(after?.summaryAttemptId).toBe(before?.summaryAttemptId);
    expect(after?.summaryRequestedAt).toBe(before?.summaryRequestedAt);
  });

  it("refuses a summary request while active or finalizing, then suppresses the double request", async () => {
    const t = newTest();
    const { callId } = await seedPendingSession(t);
    const activeId = await t.run(async (ctx) =>
      ctx.db.insert("transcriptionSessions", {
        callId,
        startedBy: "user-1",
        startedAt: Date.now(),
        status: "active",
        summaryStatus: "none",
        segmentCount: 0,
        lastSeq: 0,
      }),
    );
    const asOwner = t.withIdentity({ subject: "owner-1" });
    await expect(
      asOwner.mutation(api.transcription.requestSummary, { sessionId: activeId }),
    ).rejects.toThrow(/still being transcribed/);

    await t.run(async (ctx) => {
      await ctx.db.patch(activeId, {
        status: "ending",
        endedAt: Date.now(),
        endsAt: Date.now() + 30_000,
      });
    });
    await expect(
      asOwner.mutation(api.transcription.requestSummary, { sessionId: activeId }),
    ).rejects.toThrow(/Finishing the transcript/);

    await t.run(async (ctx) => {
      await ctx.db.patch(activeId, { endsAt: Date.now() - 1 });
    });
    await t.mutation(internal.transcription.finalizeSession, { sessionId: activeId });
    const first = await t.run(async (ctx) => await ctx.db.get(activeId));
    expect(first?.summaryStatus).toBe("pending");
    expect(first?.summaryAttemptId).toBeDefined();

    // The finalizer already queued the one attempt; a second request must not
    // replace it while it is fresh.
    await asOwner.mutation(api.transcription.requestSummary, { sessionId: activeId });
    const after = await t.run(async (ctx) => await ctx.db.get(activeId));
    expect(after?.summaryStatus).toBe("pending");
    expect(after?.summaryAttemptId).toBe(first?.summaryAttemptId);
  });

  it("returns a queued attempt to none when the API key was cleared", async () => {
    const t = newTest();
    const { sessionId } = await seedPendingSession(t);
    await t.run(async (ctx) => {
      const config = await ctx.db.query("transcriptionConfig").first();
      if (config !== null) {
        await ctx.db.patch(config._id, { apiKeyCiphertext: undefined });
      }
    });
    const fetchSpy = vi.fn(async () => summaryResponse());
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await t.action(internal.transcriptionActions.summarize, {
        sessionId,
        attemptId: SEED_ATTEMPT,
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
    expect(session?.summaryStatus).toBe("none");
    expect(session?.summaryAttemptId).toBeUndefined();
  });

  it("aborts before the next chunk and never sends a partial prefix after a mid-run disable", async () => {
    const t = newTest();
    // Seven 4,000-character segments are two summary chunks.
    const { sessionId } = await seedPendingSession(t, { segments: 7, textLength: 4_000 });
    const fetchSpy = vi.fn(async () => {
      if (fetchSpy.mock.calls.length === 1) {
        await t.withIdentity({ subject: "owner-1" }).mutation(api.addons.setEnabled, {
          addon: "transcription",
          enabled: false,
        });
      }
      return summaryResponse();
    });
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await t.action(internal.transcriptionActions.summarize, {
        sessionId,
        attemptId: SEED_ATTEMPT,
      });
    } finally {
      vi.unstubAllGlobals();
    }
    // The first chunk request completed, then the addon was disabled. No
    // second chunk request (and no merge) may follow.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(requestBodies(fetchSpy).some((body) => body.includes("PARTIAL_SUMMARIES"))).toBe(false);
    const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
    expect(session?.summaryStatus).toBe("none");
    expect(session?.summaryCiphertext).toBeUndefined();
  });

  it("does not merge once the addon is disabled after the last chunk", async () => {
    const t = newTest();
    const { sessionId } = await seedPendingSession(t, { segments: 7, textLength: 4_000 });
    const fetchSpy = vi.fn(async () => {
      if (fetchSpy.mock.calls.length === 2) {
        await t.withIdentity({ subject: "owner-1" }).mutation(api.addons.setEnabled, {
          addon: "transcription",
          enabled: false,
        });
      }
      return summaryResponse();
    });
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await t.action(internal.transcriptionActions.summarize, {
        sessionId,
        attemptId: SEED_ATTEMPT,
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(requestBodies(fetchSpy).some((body) => body.includes("PARTIAL_SUMMARIES"))).toBe(false);
    const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
    expect(session?.summaryStatus).toBe("none");
    expect(session?.summaryCiphertext).toBeUndefined();
  });

  it("aborts the whole run when a later page disappears after a disable", async () => {
    const t = newTest();
    // More than one 100-segment page: the second read happens after the first.
    const { sessionId } = await seedPendingSession(t, { segments: 120, textLength: 10 });
    const fetchSpy = vi.fn(async () => summaryResponse());
    vi.stubGlobal("fetch", fetchSpy);
    const runQuery = t.query as unknown as (ref: unknown, args: unknown) => Promise<unknown>;
    const runMutation = t.mutation as unknown as (ref: unknown, args: unknown) => Promise<unknown>;
    let laterPages = 0;
    const fakeCtx = {
      runQuery: async (ref: unknown, args: unknown) => {
        const record = args as { cursor?: unknown };
        if (record.cursor !== undefined) {
          laterPages += 1;
          if (laterPages === 1) {
            await t.withIdentity({ subject: "owner-1" }).mutation(api.addons.setEnabled, {
              addon: "transcription",
              enabled: false,
            });
          }
        }
        return await runQuery(ref, args);
      },
      runMutation: async (ref: unknown, args: unknown) => await runMutation(ref, args),
    };
    const handler = (
      summarizeAction as unknown as {
        _handler: (
          ctx: typeof fakeCtx,
          args: { sessionId: string; attemptId?: string },
        ) => Promise<unknown>;
      }
    )._handler;
    try {
      await handler(fakeCtx, { sessionId, attemptId: SEED_ATTEMPT });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(laterPages).toBe(1);
    // The first page was loaded while enabled, but the second one returned
    // null. No transcript text may reach the endpoint.
    expect(fetchSpy).not.toHaveBeenCalled();
    const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
    expect(session?.summaryStatus).toBe("none");
    expect(session?.summaryCiphertext).toBeUndefined();
  });

  it("recovers a summary after stop, a disable-time abort and a re-enable", async () => {
    const t = newTest();
    const { sessionId } = await seedPendingSession(t, { active: true });
    // `stop` queues a summary, then a disable makes the queued run abort.
    await t.withIdentity({ subject: "user-1" }).mutation(api.transcription.stop, { sessionId });
    await t.withIdentity({ subject: "owner-1" }).mutation(api.addons.setEnabled, {
      addon: "transcription",
      enabled: false,
    });
    const abortedFetch = vi.fn(async () => summaryResponse());
    vi.stubGlobal("fetch", abortedFetch);
    try {
      await t.finishAllScheduledFunctions(() => {});
    } finally {
      vi.unstubAllGlobals();
    }
    expect(abortedFetch).not.toHaveBeenCalled();
    expect(await t.run(async (ctx) => (await ctx.db.get(sessionId))?.summaryStatus)).toBe("none");

    await t.withIdentity({ subject: "owner-1" }).mutation(api.addons.setEnabled, {
      addon: "transcription",
      enabled: true,
    });
    expect(await t.mutation(internal.transcription.sessionsNeedingSummary, {})).toBe(1);
    const fetchSpy = vi.fn(async () => summaryResponse("Recovered"));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await t.finishAllScheduledFunctions(() => {});
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
    expect(session?.summaryStatus).toBe("ready");
    expect(session?.summaryCiphertext).toBeDefined();
  });

  it("never queues or errors when no summary key is configured", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1", roleIds: ["voice-host"] }],
      extraRoles: [{ key: "voice-host", permissions: TRANSCRIBER_PERMISSION, position: 2 }],
    });
    await patchSettings(t, { transcriptionEnabled: true });
    await readyConfig(t); // No API key: a supported setup.
    const { callId } = await seedCall(t);
    const { sessionId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.transcription.start, { callId });
    await t.mutation(internal.transcription.ingestSegments, {
      sessionId,
      speakerKey: "user:user-1",
      segments: [{ seq: 1, startMs: 0, endMs: 900, text: "hello" }],
    });
    await t.withIdentity({ subject: "user-1" }).mutation(api.transcription.stop, { sessionId });
    await t.finishAllScheduledFunctions(() => {});

    const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
    expect(session?.summaryStatus).toBe("none");
    expect(session?.summaryError).toBeUndefined();
    expect(session?.summaryRequestedAt).toBeUndefined();
    expect(await t.mutation(internal.transcription.sessionsNeedingSummary, {})).toBe(0);
  });

  it("moves a failed summary to error instead of leaving it pending", async () => {
    const t = newTest();
    const { sessionId } = await seedPendingSession(t);
    const fetchSpy = vi.fn(
      async () => new Response("upstream exploded", { status: 500, headers: {} }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await t.action(internal.transcriptionActions.summarize, {
        sessionId,
        attemptId: SEED_ATTEMPT,
      });
    } finally {
      vi.unstubAllGlobals();
    }
    const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(session?.summaryStatus).toBe("error");
    expect(session?.summaryError).toContain("HTTP 500");
  });
});

describe("transcription configuration", () => {
  it("seals the API key and never returns it", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    await patchSettings(t, { transcriptionEnabled: true });

    await t.withIdentity({ subject: "owner-1" }).mutation(api.transcription.updateConfig, {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-synthetic-test-key",
      model: "openai/gpt-4o-mini",
      retentionDays: 7,
    });
    const stored = await t.run(async (ctx) => await ctx.db.query("transcriptionConfig").first());
    expect(stored?.apiKeyCiphertext).not.toContain("synthetic");
    expect(stored?.retentionDays).toBe(7);

    const view = await t
      .withIdentity({ subject: "owner-1" })
      .query(api.transcription.getConfig, {});
    expect(view.hasApiKey).toBe(true);
    expect(JSON.stringify(view)).not.toContain("sk-synthetic-test-key");
    expect(view.availableModels).toContain("parakeet-tdt-0.6b-v3");

    await expect(
      t.withIdentity({ subject: "user-1" }).query(api.transcription.getConfig, {}),
    ).rejects.toThrow(/Missing permission/);
  });

  it("rejects a non-allowlisted model id", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    await patchSettings(t, { transcriptionEnabled: true });
    process.env.TRANSCRIBER_TOKEN = "test-token";
    await expect(
      t
        .withIdentity({ subject: "owner-1" })
        .mutation(api.transcription.downloadModel, { modelId: "evil/url" }),
    ).rejects.toThrow(/not available/);
    delete process.env.TRANSCRIBER_TOKEN;
  });

  it("rate-limits summary regeneration per member", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "reader", roleIds: ["reader"] }],
      extraRoles: [{ key: "reader", permissions: VIEW, position: 2 }],
    });
    await patchSettings(t, { transcriptionEnabled: true });
    await readyConfig(t);
    await t.run(async (ctx) => {
      const config = await ctx.db.query("transcriptionConfig").first();
      if (config !== null) {
        await ctx.db.patch(config._id, { apiKeyCiphertext: "sealed" });
      }
    });
    const { callId } = await seedCall(t, "owner-1");
    const sessionId = await t.run(async (ctx) =>
      ctx.db.insert("transcriptionSessions", {
        callId,
        startedBy: "owner-1",
        startedAt: Date.now() - 1000,
        endedAt: Date.now() - 500,
        status: "ended",
        summaryStatus: "none",
        segmentCount: 0,
        lastSeq: 0,
      }),
    );
    const asReader = t.withIdentity({ subject: "reader" });
    for (let index = 0; index < 5; index += 1) {
      await asReader.mutation(api.transcription.requestSummary, { sessionId });
    }
    await expect(
      asReader.mutation(api.transcription.requestSummary, { sessionId }),
    ).rejects.toThrow(/Rate limit/);
  });

  it("reports an indeterminate download progress instead of a fake 0", async () => {
    const previous = process.env.TRANSCRIBER_TOKEN;
    process.env.TRANSCRIBER_TOKEN = "test-transcriber-token";
    try {
      const t = newTest();
      await seedWorkspace(t, { members: [{ userId: "user-1" }] });
      await patchSettings(t, { transcriptionEnabled: true });
      await readyConfig(t);
      await t.run(async (ctx) => {
        const config = await ctx.db.query("transcriptionConfig").first();
        if (config !== null) {
          await ctx.db.patch(config._id, { modelProgress: 100 });
        }
      });
      await t
        .withIdentity({ subject: "owner-1" })
        .mutation(api.transcription.downloadModel, { modelId: "parakeet-tdt-0.6b-v3" });
      const status = await t
        .withIdentity({ subject: "user-1" })
        .query(api.transcription.status, {});
      expect(status.modelStatus).toBe("downloading");
      expect(status.modelProgress).toBeNull();
      const addons = await t.withIdentity({ subject: "user-1" }).query(api.addons.status, {});
      expect(addons.transcriptionModel.progress).toBeNull();

      // A later status report without a percentage stays indeterminate and
      // does not resurrect the previous model's 100.
      await t.mutation(internal.transcription.recordModelStatus, {
        modelId: "parakeet-tdt-0.6b-v3",
        status: "downloading",
      });
      const config = await t.run(async (ctx) => await ctx.db.query("transcriptionConfig").first());
      expect(config?.modelProgress).toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete process.env.TRANSCRIBER_TOKEN;
      } else {
        process.env.TRANSCRIBER_TOKEN = previous;
      }
    }
  });

  it("exposes summaryConfigured so the UI can show a neutral no-service state", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "reader", roleIds: ["reader"] }],
      extraRoles: [{ key: "reader", permissions: VIEW, position: 2 }],
    });
    await patchSettings(t, { transcriptionEnabled: true });
    await readyConfig(t);
    const { callId } = await seedCall(t, "owner-1");
    const sessionId = await t.run(async (ctx) =>
      ctx.db.insert("transcriptionSessions", {
        callId,
        startedBy: "owner-1",
        startedAt: Date.now() - 1000,
        endedAt: Date.now() - 500,
        status: "ended",
        summaryStatus: "none",
        segmentCount: 0,
        lastSeq: 0,
      }),
    );
    const asReader = t.withIdentity({ subject: "reader" });
    expect((await asReader.query(api.transcription.listSessions, {}))[0]?.summaryConfigured).toBe(
      false,
    );

    expect(
      (await asReader.query(api.transcription.getSession, { sessionId })).summaryConfigured,
    ).toBe(false);

    await t.withIdentity({ subject: "owner-1" }).mutation(api.transcription.updateConfig, {
      apiKey: "sk-synthetic-summary-key",
    });
    expect((await asReader.query(api.transcription.listSessions, {}))[0]?.summaryConfigured).toBe(
      true,
    );
  });

  it("gates deletion behind ManageTranscription", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "manager", roleIds: ["manager"] }],
      extraRoles: [
        { key: "manager", permissions: MANAGE | VIEW | TRANSCRIBER_PERMISSION, position: 2 },
      ],
    });
    await patchSettings(t, { transcriptionEnabled: true });
    await readyConfig(t);
    const { callId } = await seedCall(t, "manager");
    const { sessionId } = await t
      .withIdentity({ subject: "manager" })
      .mutation(api.transcription.start, { callId });
    await t.withIdentity({ subject: "manager" }).mutation(api.transcription.stop, { sessionId });
    await t.withIdentity({ subject: "manager" }).mutation(api.transcription.deleteSession, {
      sessionId,
    });
    expect(await t.run(async (ctx) => await ctx.db.get(sessionId))).toBeNull();
  });
});

describe("transcript titles and editing", () => {
  async function endedSession(t: Test, options: { readonly segments?: number } = {}) {
    await seedWorkspace(t, {
      members: [
        { userId: "user-1", roleIds: ["host"] },
        { userId: "viewer", roleIds: ["reader"] },
        { userId: "outsider" },
      ],
      extraRoles: [
        { key: "host", permissions: TRANSCRIBER_PERMISSION | VIEW, position: 2 },
        { key: "reader", permissions: VIEW, position: 1 },
      ],
    });
    await patchSettings(t, { transcriptionEnabled: true });
    await readyConfig(t);
    const { callId } = await seedCall(t);
    const { sessionId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.transcription.start, { callId });
    const count = options.segments ?? 3;
    for (let start = 0; start < count; start += 50) {
      const size = Math.min(50, count - start);
      await t.mutation(internal.transcription.ingestSegments, {
        sessionId,
        speakerKey: "user:user-1",
        segments: Array.from({ length: size }, (_, index) => ({
          seq: start + index + 1,
          startMs: (start + index) * 1000,
          endMs: (start + index) * 1000 + 900,
          text: `line ${start + index + 1}`,
        })),
      });
    }
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, {
        status: "ended",
        endedAt: Date.now(),
        summaryStatus: "none",
      });
    });
    return { sessionId };
  }

  const summaryJson = (title: string) =>
    JSON.stringify({
      title,
      overview: "We met.",
      keyPoints: ["a"],
      decisions: [],
      actionItems: [],
      speakerHighlights: [],
      language: "en",
    });

  async function finish(t: Test, sessionId: Id<"transcriptionSessions">, title: string) {
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { summaryStatus: "pending", summaryAttemptId: "a1" });
    });
    await t.mutation(internal.transcription.finishSummary, {
      sessionId,
      attemptId: "a1",
      status: "ready",
      json: summaryJson(title),
      model: "m",
    });
  }

  it("sets the AI title from a finished summary unless the call was renamed", async () => {
    const t = newTest();
    const { sessionId } = await endedSession(t);
    const asStarter = t.withIdentity({ subject: "user-1" });
    await finish(t, sessionId, "Launch planning");
    let session = await asStarter.query(api.transcription.getSession, { sessionId });
    expect(session.title).toBe("Launch planning");
    expect(session.titleSource).toBe("summary");
    const rows = await asStarter.query(api.transcription.listSessions, {});
    expect(rows[0]?.title).toBe("Launch planning");

    await asStarter.mutation(api.transcription.renameSession, { sessionId, title: "My name" });
    await finish(t, sessionId, "Another AI title");
    session = await asStarter.query(api.transcription.getSession, { sessionId });
    expect(session.title).toBe("My name");
    expect(session.titleSource).toBe("user");

    // Clearing the title lets the next summary set it again.
    await asStarter.mutation(api.transcription.renameSession, { sessionId, title: "   " });
    session = await asStarter.query(api.transcription.getSession, { sessionId });
    expect(session.title).toBeNull();
    expect(session.titleSource).toBeNull();
    await finish(t, sessionId, "Another AI title");
    session = await asStarter.query(api.transcription.getSession, { sessionId });
    expect(session.title).toBe("Another AI title");
  });

  it("renames with a sanitized title and enforces the edit permission", async () => {
    const t = newTest();
    const { sessionId } = await endedSession(t);
    const asStarter = t.withIdentity({ subject: "user-1" });
    await asStarter.mutation(api.transcription.renameSession, {
      sessionId,
      title: "  Weekly \n\t sync\u0007  ",
    });
    expect((await asStarter.query(api.transcription.getSession, { sessionId })).title).toBe(
      "Weekly sync",
    );
    await expect(
      asStarter.mutation(api.transcription.renameSession, {
        sessionId,
        title: "x".repeat(121),
      }),
    ).rejects.toThrow(/at most 120/);

    const asViewer = t.withIdentity({ subject: "viewer" });
    expect((await asViewer.query(api.transcription.getSession, { sessionId })).canEdit).toBe(false);
    await expect(
      asViewer.mutation(api.transcription.renameSession, { sessionId, title: "Nope" }),
    ).rejects.toThrow(/Missing transcript permission/);
    await expect(
      t
        .withIdentity({ subject: "outsider" })
        .mutation(api.transcription.renameSession, { sessionId, title: "Nope" }),
    ).rejects.toThrow();

    const asOwner = t.withIdentity({ subject: "owner-1" });
    expect((await asOwner.query(api.transcription.getSession, { sessionId })).canEdit).toBe(true);
    await asOwner.mutation(api.transcription.renameSession, { sessionId, title: "Owner title" });
    expect((await asStarter.query(api.transcription.getSession, { sessionId })).canEdit).toBe(true);
    const audit = await t.run(async (ctx) => await ctx.db.query("auditLog").take(100));
    expect(audit.filter((row) => row.action === "transcription.rename")).toHaveLength(2);
  });

  it("edits a summary, validates it and preserves title and language", async () => {
    const t = newTest();
    const { sessionId } = await endedSession(t);
    const asStarter = t.withIdentity({ subject: "user-1" });
    const edited = {
      overview: "  Edited overview ",
      keyPoints: ["Point"],
      decisions: [],
      actionItems: [{ text: "Do it", owner: null }],
      speakerHighlights: [{ speaker: "Sam", text: "Said it" }],
    };
    await finish(t, sessionId, "Launch planning");
    await asStarter.mutation(api.transcription.updateSummary, { sessionId, summary: edited });
    const session = await asStarter.query(api.transcription.getSession, { sessionId });
    const stored = JSON.parse(session.summary ?? "{}");
    expect(stored.overview).toBe("Edited overview");
    expect(stored.title).toBe("Launch planning");
    expect(stored.language).toBe("en");
    expect(session.summaryStatus).toBe("ready");
    expect(session.summaryEditedAt).not.toBeNull();
    expect(session.title).toBe("Launch planning");

    await expect(
      asStarter.mutation(api.transcription.updateSummary, {
        sessionId,
        summary: { ...edited, keyPoints: Array.from({ length: 31 }, () => "x") },
      }),
    ).rejects.toThrow(/at most 30/);
    await expect(
      asStarter.mutation(api.transcription.updateSummary, {
        sessionId,
        summary: { ...edited, decisions: ["x".repeat(601)] },
      }),
    ).rejects.toThrow(/at most 600/);
    await expect(
      t.withIdentity({ subject: "viewer" }).mutation(api.transcription.updateSummary, {
        sessionId,
        summary: edited,
      }),
    ).rejects.toThrow(/Missing transcript permission/);

    // A fresh AI summary replaces the edit and clears the marker.
    await finish(t, sessionId, "Second");
    const refreshed = await asStarter.query(api.transcription.getSession, { sessionId });
    expect(refreshed.summaryEditedAt).toBeNull();

    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { summaryStatus: "pending" });
    });
    await expect(
      asStarter.mutation(api.transcription.updateSummary, { sessionId, summary: edited }),
    ).rejects.toThrow(/being written/);
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { summaryStatus: "ready", status: "active" });
    });
    await expect(
      asStarter.mutation(api.transcription.updateSummary, { sessionId, summary: edited }),
    ).rejects.toThrow(/still being transcribed/);
  });

  it("edits a segment, flags it as edited and keeps the speaker", async () => {
    const t = newTest();
    const { sessionId } = await endedSession(t);
    const asStarter = t.withIdentity({ subject: "user-1" });
    const before = await asStarter.query(api.transcription.listSegments, { sessionId });
    expect(before.page.every((row) => !row.edited)).toBe(true);
    const target = before.page[1];
    if (target === undefined) throw new Error("missing segment");

    await asStarter.mutation(api.transcription.updateSegment, {
      segmentId: target.id as Id<"transcriptSegments">,
      text: "  corrected text ",
    });
    const after = await asStarter.query(api.transcription.listSegments, { sessionId });
    expect(after.page.map((row) => row.edited)).toEqual([false, true, false]);
    expect(after.page[1]?.text).toBe("corrected text");
    expect(after.page[1]?.speakerName).toBe(target.speakerName);

    for (const text of ["   ", "x".repeat(4_001)]) {
      await expect(
        asStarter.mutation(api.transcription.updateSegment, {
          segmentId: target.id as Id<"transcriptSegments">,
          text,
        }),
      ).rejects.toThrow(/between 1 and/);
    }
    await expect(
      t.withIdentity({ subject: "viewer" }).mutation(api.transcription.updateSegment, {
        segmentId: target.id as Id<"transcriptSegments">,
        text: "nope",
      }),
    ).rejects.toThrow(/Missing transcript permission/);
  });

  it("returns the latest segments in order, bounded, and null for a missing session", async () => {
    const t = newTest();
    const { sessionId } = await endedSession(t, { segments: 100 });
    const asViewer = t.withIdentity({ subject: "viewer" });
    const live = await asViewer.query(api.transcription.liveSegments, { sessionId });
    expect(live?.status).toBe("ended");
    expect(live?.segments).toHaveLength(40);
    expect(live?.segments[0]?.text).toBe("line 61");
    expect(live?.segments.at(-1)?.text).toBe("line 100");
    expect(live?.segments[0]?.edited).toBe(false);

    const small = await asViewer.query(api.transcription.liveSegments, { sessionId, limit: 3 });
    expect(small?.segments.map((row) => row.text)).toEqual(["line 98", "line 99", "line 100"]);
    const clampedLow = await asViewer.query(api.transcription.liveSegments, {
      sessionId,
      limit: 0,
    });
    expect(clampedLow?.segments).toHaveLength(1);
    const clampedHigh = await asViewer.query(api.transcription.liveSegments, {
      sessionId,
      limit: 5_000,
    });
    expect(clampedHigh?.segments).toHaveLength(80);

    await expect(t.query(api.transcription.liveSegments, { sessionId })).rejects.toThrow();
    await expect(
      t.withIdentity({ subject: "outsider" }).query(api.transcription.liveSegments, { sessionId }),
    ).rejects.toThrow(/Missing transcript permission/);

    await t.run(async (ctx) => {
      await ctx.db.delete(sessionId);
    });
    expect(await asViewer.query(api.transcription.liveSegments, { sessionId })).toBeNull();
  });
});
