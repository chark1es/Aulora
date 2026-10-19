import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { newTest, seedWorkspace, type Test } from "./helpers";

const RUNNER_TOKEN = "test-runner-token";
const AUTH = { authorization: `Bearer ${RUNNER_TOKEN}` };

const asOwner = (t: Test) => t.withIdentity({ subject: "owner-1" });

beforeEach(() => {
  vi.stubEnv("BOT_RUNNER_TOKEN", RUNNER_TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function makeBot(t: Test, name: string, enabled = false): Promise<Id<"bots">> {
  const created = await asOwner(t).mutation(api.bots.create, { name, language: "typescript" });
  const botId = created.botId as Id<"bots">;
  if (enabled) {
    await asOwner(t).mutation(api.bots.update, { botId, enabled: true });
  }
  return botId;
}

async function readBotLogs(t: Test, botId: Id<"bots">) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("botLogs").collect()).filter((row) => row.botId === botId),
  );
}

describe("bot runner HTTP API", () => {
  it("returns 503 when the runner token is unconfigured", async () => {
    vi.stubEnv("BOT_RUNNER_TOKEN", "");
    const t = newTest();
    await seedWorkspace(t);

    const response = await t.fetch("/bots/runner/desired", { headers: AUTH });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "bots_unavailable" });
  });

  it("returns 401 for a wrong bearer token", async () => {
    const t = newTest();
    await seedWorkspace(t);

    const response = await t.fetch("/bots/runner/desired", {
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("lists only enabled bots and records a heartbeat", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const enabled = await makeBot(t, "Enabled", true);
    await makeBot(t, "Disabled");

    const response = await t.fetch("/bots/runner/desired", { headers: AUTH });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      bots: { botId: string; entry: string; revision: number; restartNonce: number }[];
    };
    expect(body.bots).toHaveLength(1);
    expect(body.bots[0]?.botId).toBe(enabled);
    expect(body.bots[0]?.entry).toBe("main.ts");

    const status = await asOwner(t).query(api.bots.runnerStatus, {});
    expect(status.online).toBe(true);
  });

  it("serves a bundle with opened source and env, and 404s disabled or unknown bots", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const botId = await makeBot(t, "Bundled", true);
    await asOwner(t).mutation(api.bots.saveFiles, {
      botId,
      files: [{ path: "main.ts", content: "hello-bot" }],
      deletePaths: [],
    });
    await asOwner(t).mutation(api.bots.setEnv, {
      botId,
      set: [{ name: "GREETING", value: "hi-there" }],
      remove: [],
    });

    const response = await t.fetch(`/bots/runner/bundle?botId=${botId}`, { headers: AUTH });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entry: string;
      files: { path: string; content: string }[];
      env: Record<string, string>;
    };
    expect(body.entry).toBe("main.ts");
    expect(body.files).toContainEqual({ path: "main.ts", content: "hello-bot" });
    expect(body.env.GREETING).toBe("hi-there");

    const disabled = await makeBot(t, "Disabled");
    const missing = await t.fetch(`/bots/runner/bundle?botId=${disabled}`, { headers: AUTH });
    expect(missing.status).toBe(404);

    const malformed = await t.fetch("/bots/runner/bundle?botId=not-an-id", { headers: AUTH });
    expect(malformed.status).toBe(400);
  });

  it("rotates a hosted credential and stores only its hash", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const botId = await makeBot(t, "Credential", true);

    const first = await t.fetch("/bots/runner/credential", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ botId }),
    });
    expect(first.status).toBe(200);
    const firstToken = ((await first.json()) as { token: string }).token;
    expect(firstToken.startsWith("abt_")).toBe(true);

    const afterFirst = await t.run(async (ctx) => await ctx.db.get(botId));
    expect(afterFirst?.hostedTokenHash).toBeDefined();
    expect(afterFirst?.hostedTokenHash).not.toBe(firstToken);

    const second = await t.fetch("/bots/runner/credential", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ botId }),
    });
    const secondToken = ((await second.json()) as { token: string }).token;
    expect(secondToken).not.toBe(firstToken);
    const afterSecond = await t.run(async (ctx) => await ctx.db.get(botId));
    expect(afterSecond?.hostedTokenHash).not.toBe(afterFirst?.hostedTokenHash);

    const disabled = await makeBot(t, "Disabled");
    const rejected = await t.fetch("/bots/runner/credential", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ botId: disabled }),
    });
    expect(rejected.status).toBe(404);
  });

  it("records a status report and validates it", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const botId = await makeBot(t, "Reporter", true);

    const response = await t.fetch("/bots/runner/report", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ botId, status: "running", message: "up" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const bot = await t.run(async (ctx) => await ctx.db.get(botId));
    expect(bot?.status).toBe("running");
    expect(bot?.statusMessage).toBe("up");

    const badStatus = await t.fetch("/bots/runner/report", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ botId, status: "exploded" }),
    });
    expect(badStatus.status).toBe(400);

    const badBody = await t.fetch("/bots/runner/report", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ status: "running" }),
    });
    expect(badBody.status).toBe(400);
  });

  it("seals, reads back and trims captured logs to the cap", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const botId = await makeBot(t, "Logger", true);
    const now = Date.now();

    const posted = await t.fetch("/bots/runner/logs", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ botId, lines: [{ stream: "stdout", text: "hello-log", at: now }] }),
    });
    expect(posted.status).toBe(200);

    const stored = await readBotLogs(t, botId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.textCiphertext).not.toContain("hello-log");
    expect(stored[0]?.textCiphertext.startsWith("aulora-sse-")).toBe(true);

    const readBack = await asOwner(t).query(api.bots.logs, { botId });
    expect(readBack).toHaveLength(1);
    expect(readBack[0]?.text).toBe("hello-log");

    for (let batch = 0; batch < 3; batch += 1) {
      const lines = Array.from({ length: 200 }, (_, index) => ({
        stream: "stdout",
        text: `line-${batch}-${index}`,
        at: now + batch * 1000 + index,
      }));
      const response = await t.fetch("/bots/runner/logs", {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ botId, lines }),
      });
      expect(response.status).toBe(200);
    }
    expect(await readBotLogs(t, botId)).toHaveLength(500);
    expect(await asOwner(t).query(api.bots.logs, { botId })).toHaveLength(200);

    const tooMany = await t.fetch("/bots/runner/logs", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({
        botId,
        lines: Array.from({ length: 201 }, (_, index) => ({
          stream: "stdout",
          text: `x-${index}`,
          at: now,
        })),
      }),
    });
    expect(tooMany.status).toBe(400);

    const badStream = await t.fetch("/bots/runner/logs", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ botId, lines: [{ stream: "stdin", text: "x", at: now }] }),
    });
    expect(badStream.status).toBe(400);
  });
});
