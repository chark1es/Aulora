import { BOT_MCP_LIMITS } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { hashBotMcpToken } from "../convex/lib/botMcpAuth";
import { asOwner, createBot, issueToken, readAudit, seedMcpWorkspace } from "./botMcpHelpers";
import { newTest } from "./helpers";

describe("MCP token management", () => {
  it("requires ManageBots for every function", async () => {
    const t = newTest();
    await seedMcpWorkspace(t);
    const plain = t.withIdentity({ subject: "plain-1" });
    await expect(plain.query(api.botMcpTokens.list, {})).rejects.toThrow("Missing permission");
    await expect(
      plain.mutation(api.botMcpTokens.create, {
        name: "x",
        scope: "read",
        botIds: null,
        expiresInDays: 7,
      }),
    ).rejects.toThrow("Missing permission");
    const { tokenId } = await issueToken(t);
    await expect(plain.mutation(api.botMcpTokens.revoke, { tokenId })).rejects.toThrow(
      "Missing permission",
    );
  });

  it("returns the plaintext once and never stores or lists it", async () => {
    const t = newTest();
    await seedMcpWorkspace(t);
    const { token, tokenId } = await issueToken(t, { name: "  Cursor  " });
    expect(token).toMatch(/^amt_[A-Za-z0-9_-]{43}$/);

    const listed = await asOwner(t).query(api.botMcpTokens.list, {});
    expect(listed).toHaveLength(1);
    const row = listed[0];
    expect(row).toMatchObject({
      id: tokenId,
      name: "Cursor",
      scope: "write",
      botIds: null,
      tokenLast4: token.slice(-4),
      createdBy: "owner-1",
      lastUsedAt: null,
      expired: false,
    });
    expect(typeof row?.createdByName).toBe("string");
    const serialized = JSON.stringify(listed);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(await hashBotMcpToken(token));

    const stored = await t.run(async (ctx) => await ctx.db.get(tokenId));
    expect(stored?.tokenHash).toBe(await hashBotMcpToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it("audits create and revoke without the token", async () => {
    const t = newTest();
    await seedMcpWorkspace(t);
    const botId = await createBot(t, "Pinger");
    const { token, tokenId } = await issueToken(t, { botIds: [botId], scope: "read", days: 7 });
    await asOwner(t).mutation(api.botMcpTokens.revoke, { tokenId });

    const audit = await readAudit(t);
    const created = audit.find((entry) => entry.action === "bot.mcp.token.create");
    expect(JSON.parse(created?.meta ?? "{}")).toEqual({
      name: "Claude Code",
      scope: "read",
      bots: 1,
      expiresInDays: 7,
    });
    expect(audit.some((entry) => entry.action === "bot.mcp.token.revoke")).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(token);
    expect(await asOwner(t).query(api.botMcpTokens.list, {})).toEqual([]);
  });

  it("lets any ManageBots holder revoke any token", async () => {
    const t = newTest();
    await seedMcpWorkspace(t);
    const { tokenId } = await issueToken(t);
    await t.withIdentity({ subject: "manager-1" }).mutation(api.botMcpTokens.revoke, { tokenId });
    expect(await asOwner(t).query(api.botMcpTokens.list, {})).toEqual([]);
  });

  it("validates name, expiry, bots and the token cap", async () => {
    const t = newTest();
    await seedMcpWorkspace(t);
    const create = (args: { name?: string; days?: number; botIds?: never[] | null }) =>
      asOwner(t).mutation(api.botMcpTokens.create, {
        name: args.name ?? "ok",
        scope: "read",
        botIds: args.botIds ?? null,
        expiresInDays: args.days ?? 30,
      });
    await expect(create({ name: "   " })).rejects.toThrow("1 to 64");
    await expect(create({ name: "x".repeat(65) })).rejects.toThrow("1 to 64");
    await expect(create({ days: 3 })).rejects.toThrow("expire in");
    await expect(create({ botIds: [] })).rejects.toThrow("at least one bot");

    const botId = await createBot(t, "Gone");
    await asOwner(t).mutation(api.bots.remove, { botId });
    await expect(
      asOwner(t).mutation(api.botMcpTokens.create, {
        name: "x",
        scope: "read",
        botIds: [botId],
        expiresInDays: 7,
      }),
    ).rejects.toThrow("Unknown bot");

    for (let index = 0; index < BOT_MCP_LIMITS.maxTokens; index += 1) {
      await create({ name: `t${index}` });
    }
    await expect(create({ name: "one too many" })).rejects.toThrow("at most");
  });

  it("deletes a deleted account's tokens and prunes expired ones", async () => {
    const t = newTest();
    await seedMcpWorkspace(t);
    await issueToken(t, { by: "manager-1", name: "mine" });
    const keep = await issueToken(t, { by: "owner-1", name: "other" });
    await t.mutation(internal.accountDeletion.deleteUserData, { userId: "manager-1" });
    let rows = await t.run(async (ctx) => await ctx.db.query("botMcpTokens").collect());
    expect(rows.map((row) => row._id)).toEqual([keep.tokenId]);

    await t.run(async (ctx) => {
      await ctx.db.patch(keep.tokenId, { expiresAt: Date.now() - 1000 });
    });
    expect(await t.mutation(internal.botMcpInternal.pruneExpired, {})).toBe(1);
    rows = await t.run(async (ctx) => await ctx.db.query("botMcpTokens").collect());
    expect(rows).toEqual([]);
  });
});
