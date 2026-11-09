import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Permission } from "@aulora/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, seedChannel, seedWorkspace, type Test } from "./helpers";

const TOKEN = "test-transcriber-token";
const HELLO_COLD_START = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../infra/transcriber/test/fixtures/hello-cold-start.json", import.meta.url),
    ),
    "utf8",
  ),
) as Record<string, unknown>;

const previousToken = process.env.TRANSCRIBER_TOKEN;
beforeEach(() => {
  process.env.TRANSCRIBER_TOKEN = TOKEN;
});
afterEach(() => {
  if (previousToken === undefined) {
    delete process.env.TRANSCRIBER_TOKEN;
  } else {
    process.env.TRANSCRIBER_TOKEN = previousToken;
  }
});

async function postTranscriber(t: Test, path: string, body: unknown): Promise<Response> {
  return await t.fetch(path, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
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
  await t.run(async (ctx) => {
    await ctx.db.insert("transcriptionConfig", {
      modelId: "base",
      modelStatus: "ready",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4o-mini",
      retentionDays: 30,
      allowPrivateEndpoint: false,
      updatedAt: Date.now(),
      updatedBy: "owner-1",
    });
    await ctx.db.insert("transcriberStatus", {
      key: "service",
      serviceSeenAt: Date.now(),
      runtimeReady: true,
      runtimeModelId: "base",
    });
  });
}

async function seedCall(t: Test) {
  const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
  const { callId } = await t
    .withIdentity({ subject: "user-1" })
    .mutation(api.calls.start, { channelId, kind: "voice", clientId: "device-a" });
  return callId;
}

describe("transcriber HTTP null tolerance", () => {
  it("accepts the exact cold-start heartbeat and marks the service installed", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asUser = t.withIdentity({ subject: "user-1" });
    expect((await asUser.query(api.transcription.status, {})).serviceInstalled).toBe(false);

    const response = await postTranscriber(t, "/transcription/hello", HELLO_COLD_START);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const status = await asUser.query(api.transcription.status, {});
    expect(status.serviceInstalled).toBe(true);
    expect(status.modelStatus).toBe("not_installed");
  });

  it("accepts null optional hello fields and still records presence", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const response = await postTranscriber(t, "/transcription/hello", {
      type: "hello",
      loadedModelId: null,
      loadedStatus: null,
      loadedError: null,
    });
    expect(response.status).toBe(200);
    const status = await t.withIdentity({ subject: "user-1" }).query(api.transcription.status, {});
    expect(status.serviceInstalled).toBe(true);
    expect(status.modelStatus).toBe("not_installed");
  });

  it("records presence even when a model field is malformed", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const response = await postTranscriber(t, "/transcription/hello", {
      type: "hello",
      loadedModelId: 123,
      loadedStatus: "downloading",
      loadedError: "x".repeat(301),
    });
    expect(response.status).toBe(200);
    const status = await t.withIdentity({ subject: "user-1" }).query(api.transcription.status, {});
    expect(status.serviceInstalled).toBe(true);
    expect(status.modelStatus).toBe("not_installed");
  });

  it("accepts null optional model-status fields and clears stale progress", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    await t.run(async (ctx) => {
      await ctx.db.insert("transcriptionConfig", {
        modelId: "base",
        modelStatus: "ready",
        modelProgress: 100,
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "openai/gpt-4o-mini",
        retentionDays: 30,
        allowPrivateEndpoint: false,
        updatedAt: Date.now(),
        updatedBy: "owner-1",
      });
    });
    const response = await postTranscriber(t, "/transcription/model", {
      modelId: "small",
      status: "downloading",
      progress: null,
      error: null,
    });
    expect(response.status).toBe(200);
    const config = await t.run(async (ctx) => await ctx.db.query("transcriptionConfig").first());
    expect(config?.modelStatus).toBe("downloading");
    expect(config?.modelProgress).toBeUndefined();
    expect(config?.modelError).toBeUndefined();
  });

  it("accepts authorized final audio within the grace and rejects it after", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1", roleIds: ["voice-host"] }],
      extraRoles: [{ key: "voice-host", permissions: Permission.StartTranscription, position: 2 }],
    });
    await patchSettings(t, { transcriptionEnabled: true });
    await readyConfig(t);
    const callId = await seedCall(t);
    const { sessionId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.transcription.start, { callId });
    await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.transcription.mintAudioTokenForCall, { sessionId });
    await t.withIdentity({ subject: "user-1" }).mutation(api.transcription.stop, { sessionId });
    await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.calls.leave, { callId, clientId: "device-a" });

    const withinGrace = await postTranscriber(t, "/transcription/ingest", {
      sessionId,
      speakerKey: "user:user-1",
      segments: [{ seq: 1, startMs: 0, endMs: 900, text: "final words" }],
    });
    expect(withinGrace.status).toBe(200);
    expect(await withinGrace.json()).toMatchObject({ ok: true, accepted: 1 });

    const afterCutoff = await postTranscriber(t, "/transcription/ingest", {
      sessionId,
      speakerKey: "user:user-1",
      segments: [{ seq: 2, startMs: 999_999, endMs: 1_000_000, text: "late" }],
    });
    expect(afterCutoff.status).toBe(400);

    const neverSeated = await postTranscriber(t, "/transcription/ingest", {
      sessionId,
      speakerKey: "user:user-2",
      segments: [{ seq: 1, startMs: 0, endMs: 900, text: "stranger" }],
    });
    expect(neverSeated.status).toBe(400);

    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { endsAt: Date.now() - 1 });
    });
    const afterGrace = await postTranscriber(t, "/transcription/ingest", {
      sessionId,
      speakerKey: "user:user-1",
      segments: [{ seq: 2, startMs: 0, endMs: 900, text: "too late" }],
    });
    expect(afterGrace.status).toBe(400);
  });

  it("clears a download left downloading after a transcriber restart", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    await t.run(async (ctx) => {
      await ctx.db.insert("transcriptionConfig", {
        modelId: "small",
        modelStatus: "downloading",
        modelProgress: undefined,
        modelUpdatedAt: Date.now() - 2 * 60_000,
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "",
        retentionDays: 30,
        allowPrivateEndpoint: false,
        updatedAt: Date.now() - 2 * 60_000,
        updatedBy: "owner-1",
      });
    });
    const response = await postTranscriber(t, "/transcription/hello", {
      type: "hello",
      loadedStatus: "not_installed",
    });
    expect(response.status).toBe(200);
    let config = await t.run(async (ctx) => await ctx.db.query("transcriptionConfig").first());
    expect(config?.modelStatus).toBe("error");
    expect(config?.modelError).toContain("interrupted");

    await t.run(async (ctx) => {
      const row = await ctx.db.query("transcriptionConfig").first();
      if (row !== null) {
        await ctx.db.patch(row._id, {
          modelStatus: "downloading",
          modelError: undefined,
          modelUpdatedAt: Date.now() - 2 * 60_000,
        });
      }
    });
    const active = await postTranscriber(t, "/transcription/hello", {
      type: "hello",
      loadedStatus: "not_installed",
      downloadActive: true,
    });
    expect(active.status).toBe(200);
    config = await t.run(async (ctx) => await ctx.db.query("transcriptionConfig").first());
    expect(config?.modelStatus).toBe("downloading");
  });

  it("accepts null optional segment fields on ingest", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1", roleIds: ["voice-host"] }],
      extraRoles: [{ key: "voice-host", permissions: Permission.StartTranscription, position: 2 }],
    });
    await patchSettings(t, { transcriptionEnabled: true });
    await readyConfig(t);
    const callId = await seedCall(t);
    const { sessionId } = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.transcription.start, { callId });

    const response = await postTranscriber(t, "/transcription/ingest", {
      sessionId,
      speakerKey: "user:user-1",
      segments: [
        {
          seq: 1,
          startMs: 0,
          endMs: 900,
          text: "hello",
          confidence: null,
          language: null,
        },
      ],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, accepted: 1 });
  });
});
