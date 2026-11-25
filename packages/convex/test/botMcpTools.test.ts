import { Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { hashBotMcpToken } from "../convex/lib/botMcpAuth";
import {
  asOwner,
  callTool,
  createBot,
  issueToken,
  readAudit,
  rpc,
  seedMcpWorkspace,
} from "./botMcpHelpers";
import { newTest, type Test } from "./helpers";

const READ_TOOLS = ["list_bots", "get_bot", "read_file", "read_logs", "get_runner_status"];
const WRITE_TOOLS = ["create_bot", "update_bot", "write_files", "set_env", "restart_bot"];

async function listToolNames(t: Test, token: string): Promise<string[]> {
  const { body } = await rpc(t, token, "tools/list");
  const tools = (body.result as { tools: { name: string }[] }).tools;
  return tools.map((tool) => tool.name);
}

async function readBot(t: Test, botId: Id<"bots">) {
  return await t.run(async (ctx) => await ctx.db.get(botId));
}

describe("MCP tools", () => {
  it("runs create -> write_files -> read_file -> enable -> restart with audits", async () => {
    const t = newTest();
    await seedMcpWorkspace(t);
    const { token, tokenId } = await issueToken(t);

    const created = await callTool(t, token, "create_bot", {
      name: "Echo",
      language: "typescript",
      template: "blank",
    });
    expect(created.isError).toBe(false);
    const botId = created.data.id as Id<"bots">;
    expect(created.data).toMatchObject({ enabled: false, grants: [], revision: 1, fileCount: 1 });

    const written = await callTool(t, token, "write_files", {
      botId,
      files: [
        { path: "main.ts", content: "console.log('hi')\n" },
        { path: "lib/a.ts", content: "x" },
      ],
    });
    expect(written.data).toMatchObject({ revision: 2, saved: ["main.ts", "lib/a.ts"] });

    const file = await callTool(t, token, "read_file", { botId, path: "main.ts" });
    expect(file.data).toMatchObject({ content: "console.log('hi')\n", bytes: 18 });

    const updated = await callTool(t, token, "update_bot", { botId, enabled: true });
    expect(updated.data).toMatchObject({ enabled: true, revision: 3 });

    const restarted = await callTool(t, token, "restart_bot", { botId });
    expect(restarted.isError).toBe(false);
    expect((await readBot(t, botId))?.restartNonce).toBe(1);

    const detail = await callTool(t, token, "get_bot", { botId });
    expect(detail.data.files).toEqual([
      { path: "lib/a.ts", bytes: 1 },
      { path: "main.ts", bytes: 18 },
    ]);

    const audit = await readAudit(t);
    for (const action of ["bot.create", "bot.files", "bot.update", "bot.restart"]) {
      const row = audit.find((entry) => entry.action === action);
      expect(row?.actorId).toBe("owner-1");
      expect(JSON.parse(row?.meta ?? "{}")).toMatchObject({ via: "mcp", tokenId });
    }
  });

  it("matches the UI mutations on validation errors", async () => {
    const t = newTest();
    await seedMcpWorkspace(t);
    const { token } = await issueToken(t);
    const botId = await createBot(t, "Existing");
    const bad = await callTool(t, token, "write_files", {
      botId,
      files: [{ path: "a/../evil.ts", content: "x" }],
    });
    expect(bad).toMatchObject({ isError: true });
    expect(bad.text).toContain("'..'");
    const dup = await callTool(t, token, "create_bot", { name: "existing", language: "python" });
    expect(dup.text).toContain("already exists");
    const unknownKey = await callTool(t, token, "restart_bot", { botId, force: true });
    expect(unknownKey.text).toContain('unknown argument "force"');
    const badType = await callTool(t, token, "read_logs", { botId, limit: "many" });
    expect(badType.isError).toBe(true);
    const empty = await callTool(t, token, "write_files", { botId });
    expect(empty.isError).toBe(true);
    expect((await readBot(t, botId))?.revision).toBe(1);
  });

  it("never returns env values", async () => {
    const t = newTest();
    await seedMcpWorkspace(t);
    const { token } = await issueToken(t);
    const botId = await createBot(t, "Envy");
    const result = await callTool(t, token, "set_env", {
      botId,
      set: [{ name: "API_KEY", value: "super-secret-value" }],
    });
    expect(result.data).toEqual({ revision: 2, envNames: ["API_KEY"] });
    const detail = await callTool(t, token, "get_bot", { botId });
    expect(detail.data.envNames).toEqual(["API_KEY"]);
    for (const reply of [result, detail]) {
      expect(reply.text).not.toContain("super-secret-value");
    }
    const audit = await readAudit(t);
    expect(JSON.stringify(audit)).not.toContain("super-secret-value");
    const bad = await callTool(t, token, "set_env", {
      botId,
      set: [{ name: "AULORA_X", value: "1" }],
    });
    expect(bad.isError).toBe(true);
    const removed = await callTool(t, token, "set_env", { botId, remove: ["API_KEY"] });
    expect(removed.data.envNames).toEqual([]);
  });

  it("reads logs and runner status", async () => {
    const t = newTest();
    await seedMcpWorkspace(t);
    const { token } = await issueToken(t, { scope: "read" });
    const botId = await createBot(t, "Loud");
    const empty = await callTool(t, token, "read_logs", { botId, limit: 5 });
    expect(empty.data).toEqual({ lines: [] });
    expect((await callTool(t, token, "read_logs", { botId, limit: 501 })).isError).toBe(true);
    const status = await callTool(t, token, "get_runner_status");
    expect(status.data).toEqual({ online: false, lastSeenAt: null });
  });

  it("gives a read token only the read tools", async () => {
    const t = newTest();
    await seedMcpWorkspace(t);
    const read = await issueToken(t, { scope: "read" });
    const write = await issueToken(t, { scope: "write", name: "w" });
    expect(await listToolNames(t, read.token)).toEqual(READ_TOOLS);
    expect(await listToolNames(t, write.token)).toEqual([...READ_TOOLS, ...WRITE_TOOLS]);

    const botId = await createBot(t, "Guarded");
    for (const name of WRITE_TOOLS) {
      const { body } = await rpc(t, read.token, "tools/call", {
        name,
        arguments: { botId, name: "x", language: "python" },
      });
      expect((body.error as { code: number }).code).toBe(-32602);
    }
    expect((await readBot(t, botId))?.revision).toBe(1);
    expect((await callTool(t, read.token, "get_bot", { botId })).isError).toBe(false);
  });

  it("describes every tool with a closed JSON Schema", async () => {
    const t = newTest();
    await seedMcpWorkspace(t);
    const { token } = await issueToken(t);
    const { body } = await rpc(t, token, "tools/list");
    const tools = (body.result as { tools: Record<string, unknown>[] }).tools;
    for (const tool of tools) {
      expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(tool.annotations).toHaveProperty("readOnlyHint");
      expect(String(tool.description).length).toBeGreaterThan(20);
    }
    const names = tools.map((tool) => String(tool.name));
    for (const absent of ["delete_bot", "set_permissions", "rotate_token", "create_token"]) {
      expect(names).not.toContain(absent);
    }
  });

  describe("botIds restriction", () => {
    it("hides other bots, reports them as not found and refuses create_bot", async () => {
      const t = newTest();
      await seedMcpWorkspace(t);
      const allowed = await createBot(t, "Allowed");
      const other = await createBot(t, "Other");
      const { token } = await issueToken(t, { botIds: [allowed] });

      const listed = await callTool(t, token, "list_bots");
      expect((listed.data.bots as { id: string }[]).map((bot) => bot.id)).toEqual([allowed]);

      const calls: [string, Record<string, unknown>][] = [
        ["get_bot", { botId: other }],
        ["read_file", { botId: other, path: "main.ts" }],
        ["read_logs", { botId: other }],
        ["update_bot", { botId: other, enabled: true }],
        ["write_files", { botId: other, files: [{ path: "a.ts", content: "x" }] }],
        ["set_env", { botId: other, set: [{ name: "A", value: "1" }] }],
        ["restart_bot", { botId: other }],
        ["get_bot", { botId: "not-an-id" }],
      ];
      const messages = new Set<string>();
      for (const [name, args] of calls) {
        const reply = await callTool(t, token, name, args);
        expect(reply.isError).toBe(true);
        messages.add(reply.text);
      }
      expect([...messages]).toEqual(["Bot not found"]);
      expect((await readBot(t, other))?.revision).toBe(1);

      const created = await callTool(t, token, "create_bot", { name: "New", language: "python" });
      expect(created.isError).toBe(true);
      expect(created.text).toContain("restricted");
      expect(
        (await callTool(t, token, "update_bot", { botId: allowed, enabled: true })).isError,
      ).toBe(false);
    });
  });

  describe("creator ceiling", () => {
    it("refuses to control a bot with grants the creator lacks", async () => {
      const t = newTest();
      await seedMcpWorkspace(t);
      const botId = await createBot(t, "Powerful");
      await asOwner(t).mutation(api.bots.setPermissions, {
        botId,
        grants: Permission.ManageMessages,
        allowedChannelIds: null,
      });
      const manager = await issueToken(t, { by: "manager-1" });
      const owner = await issueToken(t, { name: "owner" });

      for (const [name, args] of [
        ["write_files", { botId, files: [{ path: "a.ts", content: "x" }] }],
        ["set_env", { botId, set: [{ name: "A", value: "1" }] }],
        ["update_bot", { botId, enabled: true }],
        ["restart_bot", { botId }],
      ] as const) {
        const reply = await callTool(t, manager.token, name, { ...args });
        expect(reply).toMatchObject({
          isError: true,
          text: "This bot has permissions you do not hold",
        });
      }
      const bot = await readBot(t, botId);
      expect(bot).toMatchObject({ revision: 1, restartNonce: 0, enabled: false });

      const listed = await callTool(t, manager.token, "list_bots");
      expect((listed.data.bots as { grants: string[] }[])[0]?.grants).toEqual(["ManageMessages"]);
      expect((await callTool(t, owner.token, "restart_bot", { botId })).isError).toBe(false);
    });
  });

  it("re-authorizes inside the tool transaction", async () => {
    const t = newTest();
    await seedMcpWorkspace(t);
    const botId = await createBot(t, "Racy");
    const { token } = await issueToken(t, { by: "manager-1" });
    const tokenHash = await hashBotMcpToken(token);
    const args = { tokenHash, name: "restart_bot", argsJson: JSON.stringify({ botId }) };
    await t.mutation(internal.botMcpInternal.writeTool, args);
    await t.run(async (ctx) => {
      await ctx.db.insert("bans", { userId: "manager-1", actorId: "owner-1", at: Date.now() });
    });
    await expect(t.mutation(internal.botMcpInternal.writeTool, args)).rejects.toThrow(
      "no longer has access",
    );
    expect((await readBot(t, botId))?.restartNonce).toBe(1);
    expect((await rpc(t, token, "ping")).status).toBe(403);
  });
});
