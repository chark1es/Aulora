import { BOT_MCP_MAX_BODY_BYTES, BOT_MCP_RATE_LIMIT, EVERYONE_ROLE_ID } from "@aulora/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashBotMcpToken } from "../convex/lib/botMcpAuth";
import { issueToken, post, rpc, seedMcpWorkspace } from "./botMcpHelpers";
import { newTest } from "./helpers";

const SITE = "https://chat.example.com";

beforeEach(() => {
  vi.stubEnv("SITE_URL", SITE);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const GOOD_BODY = { jsonrpc: "2.0", id: 1, method: "ping" };

describe("MCP authentication", () => {
  it("returns 401 with a challenge when the header is missing or malformed", async () => {
    const t = newTest();
    await seedMcpWorkspace(t);
    const { token } = await issueToken(t);
    for (const header of [null, `Basic ${token}`, "Bearer nope", `Bearer ${token}x`, "Bearer"]) {
      const response = await t.fetch("/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(header === null ? {} : { authorization: header }),
        },
        body: JSON.stringify(GOOD_BODY),
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe('Bearer realm="aulora-mcp"');
      const body = (await response.json()) as { jsonrpc: string; error: { code: number } };
      expect(body.jsonrpc).toBe("2.0");
      expect(typeof body.error.code).toBe("number");
    }
  });

  it("answers unknown, expired and revoked tokens identically", async () => {
    const t = newTest();
    await seedMcpWorkspace(t);
    const unknown = await post(t, `amt_${"A".repeat(43)}`, GOOD_BODY);
    const expired = await issueToken(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(expired.tokenId, { expiresAt: Date.now() - 1 });
    });
    const expiredResponse = await post(t, expired.token, GOOD_BODY);
    const revoked = await issueToken(t, { name: "revoked" });
    await t.run(async (ctx) => await ctx.db.delete(revoked.tokenId));
    const revokedResponse = await post(t, revoked.token, GOOD_BODY);

    const bodies = [];
    for (const response of [unknown, expiredResponse, revokedResponse]) {
      expect(response.status).toBe(401);
      bodies.push(await response.text());
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it("returns 403 once the creator is no longer a ManageBots member", async () => {
    const t = newTest();
    await seedMcpWorkspace(t);
    const lostRole = await issueToken(t, { by: "manager-1", name: "a" });
    const removed = await issueToken(t, { by: "manager-1", name: "b" });
    expect((await post(t, lostRole.token, GOOD_BODY)).status).toBe(200);

    await t.run(async (ctx) => {
      const member = (await ctx.db.query("members").collect()).find(
        (row) => row.userId === "manager-1",
      );
      if (member !== null) {
        await ctx.db.patch(member._id, { roleIds: [EVERYONE_ROLE_ID] });
      }
    });
    expect((await post(t, lostRole.token, GOOD_BODY)).status).toBe(403);

    await t.run(async (ctx) => {
      const member = (await ctx.db.query("members").collect()).find(
        (row) => row.userId === "manager-1",
      );
      if (member !== null) {
        await ctx.db.delete(member._id);
      }
    });
    expect((await post(t, removed.token, GOOD_BODY)).status).toBe(403);
  });

  it("returns 403 for a banned creator", async () => {
    const t = newTest();
    await seedMcpWorkspace(t);
    const { token } = await issueToken(t, { by: "manager-1" });
    await t.run(async (ctx) => {
      await ctx.db.insert("bans", { userId: "manager-1", actorId: "owner-1", at: Date.now() });
    });
    expect((await post(t, token, GOOD_BODY)).status).toBe(403);
  });

  it("rate limits per token hash before the lookup", async () => {
    const t = newTest();
    await seedMcpWorkspace(t);
    const { token } = await issueToken(t);
    const hash = await hashBotMcpToken(token);
    await t.run(async (ctx) => {
      await ctx.db.insert("rateLimits", {
        key: `bot-mcp:${hash}`,
        windowStart: Date.now(),
        count: BOT_MCP_RATE_LIMIT.limit,
      });
    });
    const response = await post(t, token, GOOD_BODY);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).not.toBeNull();
  });

  it("refreshes lastUsedAt at most once a minute", async () => {
    const t = newTest();
    await seedMcpWorkspace(t);
    const { token, tokenId } = await issueToken(t);
    await post(t, token, GOOD_BODY);
    const first = await t.run(async (ctx) => (await ctx.db.get(tokenId))?.lastUsedAt);
    expect(first).toBeTypeOf("number");
    await post(t, token, GOOD_BODY);
    expect(await t.run(async (ctx) => (await ctx.db.get(tokenId))?.lastUsedAt)).toBe(first);
    await t.run(async (ctx) => await ctx.db.patch(tokenId, { lastUsedAt: Date.now() - 61_000 }));
    await post(t, token, GOOD_BODY);
    const later = await t.run(async (ctx) => (await ctx.db.get(tokenId))?.lastUsedAt);
    expect(later).toBeGreaterThan(Date.now() - 5_000);
  });
});

describe("MCP transport", () => {
  async function setup() {
    const t = newTest();
    await seedMcpWorkspace(t);
    const { token } = await issueToken(t);
    return { t, token };
  }

  it("rejects a foreign Origin and accepts the workspace Origin", async () => {
    const { t, token } = await setup();
    expect((await post(t, token, GOOD_BODY, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(t, token, GOOD_BODY, { origin: SITE })).status).toBe(200);
    expect((await post(t, token, GOOD_BODY)).status).toBe(200);
  });

  it("rejects an Origin when no site URL is configured", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("SITE_URL", "");
    vi.stubEnv("CONVEX_SITE_URL", "");
    const { t, token } = await setup();
    expect((await post(t, token, GOOD_BODY, { origin: SITE })).status).toBe(403);
  });

  it("requires a JSON content type", async () => {
    const { t, token } = await setup();
    const response = await post(t, token, JSON.stringify(GOOD_BODY), {
      "content-type": "text/plain",
    });
    expect(response.status).toBe(415);
    expect(
      (
        await post(t, token, JSON.stringify(GOOD_BODY), {
          "content-type": "application/json; charset=utf-8",
        })
      ).status,
    ).toBe(200);
  });

  it("caps the body by declared and actual size", async () => {
    const { t, token } = await setup();
    const declared = await post(t, token, GOOD_BODY, {
      "content-length": String(BOT_MCP_MAX_BODY_BYTES + 1),
    });
    expect(declared.status).toBe(413);
    const padding = "x".repeat(BOT_MCP_MAX_BODY_BYTES + 10);
    const actual = await post(t, token, { ...GOOD_BODY, params: { padding } });
    expect(actual.status).toBe(413);
  });

  it("answers GET and DELETE with 405 and Allow: POST", async () => {
    const { t, token } = await setup();
    for (const method of ["GET", "DELETE"]) {
      const response = await t.fetch("/api/mcp", {
        method,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
  });

  it("sends no-store and no CORS headers", async () => {
    const { t, token } = await setup();
    const response = await post(t, token, GOOD_BODY);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("handles batches, bad JSON, unknown methods, bad params and notifications", async () => {
    const { t, token } = await setup();
    const batch = await post(t, token, [GOOD_BODY]);
    expect(batch.status).toBe(400);
    expect(((await batch.json()) as { error: { code: number } }).error.code).toBe(-32600);

    const broken = await post(t, token, "{nope");
    expect(((await broken.json()) as { error: { code: number } }).error.code).toBe(-32700);

    const unknown = await rpc(t, token, "resources/list");
    expect((unknown.body.error as { code: number }).code).toBe(-32601);

    const badInit = await rpc(t, token, "initialize", {});
    expect((badInit.body.error as { code: number }).code).toBe(-32602);
    const badCall = await rpc(t, token, "tools/call", { arguments: {} });
    expect((badCall.body.error as { code: number }).code).toBe(-32602);

    const notification = await post(t, token, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(notification.status).toBe(202);
    expect(await notification.text()).toBe("");
  });

  it("negotiates the protocol version and describes the server", async () => {
    const { t, token } = await setup();
    const echoed = await rpc(t, token, "initialize", { protocolVersion: "2025-03-26" });
    const result = echoed.body.result as {
      protocolVersion: string;
      capabilities: unknown;
      serverInfo: { name: string };
      instructions: string;
    };
    expect(result.protocolVersion).toBe("2025-03-26");
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(result.serverInfo.name).toBe("aulora-bots");
    expect(result.instructions).toContain("@aulora/bot");
    expect(result.instructions).toContain("aulora_bot");
    expect(result.instructions).toContain("web UI");

    const fallback = await rpc(t, token, "initialize", { protocolVersion: "1999-01-01" });
    expect((fallback.body.result as { protocolVersion: string }).protocolVersion).toBe(
      "2025-06-18",
    );
    expect((await rpc(t, token, "ping")).body.result).toEqual({});
  });
});
