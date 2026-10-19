import { BOT_LIMITS, BOT_USER_ID_PREFIX, EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { newTest, seedChannel, seedWorkspace, type Test } from "./helpers";

const asOwner = (t: Test) => t.withIdentity({ subject: "owner-1" });

/** Serializes a bot payload for leak checks; `grants` is a bigint. */
const json = (value: unknown): string =>
  JSON.stringify(value, (_key, inner) => (typeof inner === "bigint" ? inner.toString() : inner));

async function createBot(t: Test, name = "Helper"): Promise<Id<"bots">> {
  const created = await asOwner(t).mutation(api.bots.create, {
    name,
    language: "typescript",
    template: "hello",
  });
  return created.botId as Id<"bots">;
}

async function readBot(t: Test, botId: Id<"bots">) {
  return await t.run(async (ctx) => await ctx.db.get(botId));
}

async function readFiles(t: Test, botId: Id<"bots">) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("botFiles").collect()).filter((row) => row.botId === botId),
  );
}

async function readAudit(t: Test) {
  return await t.run(async (ctx) => await ctx.db.query("auditLog").collect());
}

describe("bots management", () => {
  describe("permission gating", () => {
    it("rejects a member without ManageBots", async () => {
      const t = newTest();
      await seedWorkspace(t, { members: [{ userId: "user-1" }] });

      await expect(t.withIdentity({ subject: "user-1" }).query(api.bots.list, {})).rejects.toThrow(
        "Missing permission",
      );
    });

    it("allows the owner and a role with ManageBots", async () => {
      const t = newTest();
      await seedWorkspace(t, {
        extraRoles: [{ key: "botadmin", permissions: Permission.ManageBots, position: 5 }],
        members: [{ userId: "manager-1", roleIds: [EVERYONE_ROLE_ID, "botadmin"] }],
      });

      expect(await asOwner(t).query(api.bots.list, {})).toEqual([]);
      expect(await t.withIdentity({ subject: "manager-1" }).query(api.bots.list, {})).toEqual([]);
    });
  });

  describe("create", () => {
    it("inserts a disabled bot with a member row, starter files and an audit entry", async () => {
      const t = newTest();
      await seedWorkspace(t);
      const botId = await createBot(t, "Pinger");

      const bot = await readBot(t, botId);
      expect(bot).not.toBeNull();
      expect(bot?.enabled).toBe(false);
      expect(bot?.grants).toBe(0n);
      expect(bot?.revision).toBe(1);
      expect(bot?.restartNonce).toBe(0);
      expect(bot?.status).toBe("stopped");
      expect(bot?.userId).toBe(`${BOT_USER_ID_PREFIX}${botId}`);

      const member = await t.run(async (ctx) => {
        const all = await ctx.db.query("members").collect();
        return all.find((row) => row.userId === bot?.userId) ?? null;
      });
      expect(member?.nickname).toBe("Pinger");
      expect(member?.roleIds).toEqual([]);

      const files = await readFiles(t, botId);
      expect(files.map((file) => file.path)).toEqual(["main.ts"]);
      expect(files[0]?.contentCiphertext.startsWith("aulora-sse-")).toBe(true);

      const audit = await readAudit(t);
      expect(audit.some((entry) => entry.action === "bot.create" && entry.targetId === botId)).toBe(
        true,
      );
    });

    it("returns opened template content and supports the python/blank template", async () => {
      const t = newTest();
      await seedWorkspace(t);
      const created = await asOwner(t).mutation(api.bots.create, {
        name: "PyBot",
        language: "python",
        template: "blank",
      });
      const botId = created.botId as Id<"bots">;

      const detail = await asOwner(t).query(api.bots.get, { botId });
      expect(detail?.language).toBe("python");
      expect(detail?.files.map((file) => file.path)).toEqual(["main.py"]);
      expect(detail?.files[0]?.content).toContain("aulora_bot");
      expect(detail?.envNames).toEqual([]);
    });

    it("enforces name rules and uniqueness (case-insensitive)", async () => {
      const t = newTest();
      await seedWorkspace(t);
      await createBot(t, "Unique");

      await expect(
        asOwner(t).mutation(api.bots.create, { name: "  ", language: "typescript" }),
      ).rejects.toThrow("1 to 32");
      await expect(
        asOwner(t).mutation(api.bots.create, { name: "x".repeat(33), language: "typescript" }),
      ).rejects.toThrow("1 to 32");
      await expect(
        asOwner(t).mutation(api.bots.create, { name: "unique", language: "typescript" }),
      ).rejects.toThrow("already exists");
    });

    it("refuses once the bot count reaches the cap", async () => {
      const t = newTest();
      await seedWorkspace(t);
      await t.run(async (ctx) => {
        for (let index = 0; index < BOT_LIMITS.maxBots; index += 1) {
          await ctx.db.insert("bots", {
            userId: `bot_seed-${index}`,
            name: `Seed ${index}`,
            language: "typescript",
            enabled: false,
            grants: 0n,
            createdBy: "owner-1",
            createdAt: Date.now(),
            revision: 1,
            restartNonce: 0,
            status: "stopped",
            statusAt: Date.now(),
          });
        }
      });

      await expect(
        asOwner(t).mutation(api.bots.create, { name: "Too many", language: "typescript" }),
      ).rejects.toThrow(`at most ${BOT_LIMITS.maxBots}`);
    });
  });

  describe("update", () => {
    it("renames the bot and its member nickname", async () => {
      const t = newTest();
      await seedWorkspace(t);
      const botId = await createBot(t, "Before");

      await asOwner(t).mutation(api.bots.update, { botId, name: "After" });
      const bot = await readBot(t, botId);
      expect(bot?.name).toBe("After");
      const member = await t.run(async (ctx) => {
        const all = await ctx.db.query("members").collect();
        return all.find((row) => row.userId === bot?.userId) ?? null;
      });
      expect(member?.nickname).toBe("After");
    });

    it("disabling stops the bot, clears the hosted credential and bumps the revision", async () => {
      const t = newTest();
      await seedWorkspace(t);
      const botId = await createBot(t);
      await asOwner(t).mutation(api.bots.update, { botId, enabled: true });
      await t.run(async (ctx) => {
        await ctx.db.patch(botId, { hostedTokenHash: "deadbeef" });
      });

      await asOwner(t).mutation(api.bots.update, { botId, enabled: false });
      const bot = await readBot(t, botId);
      expect(bot?.enabled).toBe(false);
      expect(bot?.status).toBe("stopped");
      expect(bot?.hostedTokenHash).toBeUndefined();
      expect(bot?.revision).toBe(3);
    });

    it("changing the language bumps the revision without reseeding files", async () => {
      const t = newTest();
      await seedWorkspace(t);
      const botId = await createBot(t);

      await asOwner(t).mutation(api.bots.update, { botId, language: "python" });
      const bot = await readBot(t, botId);
      expect(bot?.language).toBe("python");
      expect(bot?.revision).toBe(2);
      expect((await readFiles(t, botId)).map((file) => file.path)).toEqual(["main.ts"]);
    });
  });

  describe("setPermissions", () => {
    it("rejects blocked permission bits with a clear message", async () => {
      const t = newTest();
      await seedWorkspace(t);
      const botId = await createBot(t);

      await expect(
        asOwner(t).mutation(api.bots.setPermissions, {
          botId,
          grants: Permission.Administrator,
          allowedChannelIds: null,
        }),
      ).rejects.toThrow("cannot be granted to a bot");
    });

    it("refuses a non-owner granting a permission they do not hold", async () => {
      const t = newTest();
      await seedWorkspace(t, {
        extraRoles: [{ key: "botadmin", permissions: Permission.ManageBots, position: 5 }],
        members: [{ userId: "manager-1", roleIds: [EVERYONE_ROLE_ID, "botadmin"] }],
      });
      const botId = await createBot(t);

      await expect(
        t.withIdentity({ subject: "manager-1" }).mutation(api.bots.setPermissions, {
          botId,
          grants: Permission.Ban,
          allowedChannelIds: null,
        }),
      ).rejects.toThrow("Cannot grant");
    });

    it("rejects an unknown channel in the scope", async () => {
      const t = newTest();
      await seedWorkspace(t);
      const botId = await createBot(t);
      const channelId = await seedChannel(t, {});
      await t.run(async (ctx) => {
        await ctx.db.delete(channelId);
      });

      await expect(
        asOwner(t).mutation(api.bots.setPermissions, {
          botId,
          grants: Permission.SendMessages,
          allowedChannelIds: [channelId],
        }),
      ).rejects.toThrow("Unknown channel");
    });

    it("stores valid grants and the channel scope", async () => {
      const t = newTest();
      await seedWorkspace(t);
      const botId = await createBot(t);
      const channelId = await seedChannel(t, {});

      await asOwner(t).mutation(api.bots.setPermissions, {
        botId,
        grants: Permission.SendMessages | Permission.AddReactions,
        allowedChannelIds: [channelId],
      });
      const bot = await readBot(t, botId);
      expect(bot?.grants).toBe(Permission.SendMessages | Permission.AddReactions);
      expect(bot?.allowedChannelIds).toEqual([channelId]);
    });
  });

  describe("control ceiling", () => {
    it("stops an admin editing a bot more powerful than they are", async () => {
      const t = newTest();
      await seedWorkspace(t, {
        extraRoles: [{ key: "botadmin", permissions: Permission.ManageBots, position: 5 }],
        members: [{ userId: "manager-1", roleIds: [EVERYONE_ROLE_ID, "botadmin"] }],
      });
      const botId = await createBot(t);
      await asOwner(t).mutation(api.bots.setPermissions, {
        botId,
        grants: Permission.Ban,
        allowedChannelIds: null,
      });
      const manager = t.withIdentity({ subject: "manager-1" });

      await expect(
        manager.mutation(api.bots.saveFiles, { botId, files: [{ path: "a.ts", content: "x" }] }),
      ).rejects.toThrow("permissions you do not hold");
      await expect(
        manager.mutation(api.bots.setEnv, { botId, set: [{ name: "A", value: "b" }], remove: [] }),
      ).rejects.toThrow("permissions you do not hold");
      await expect(manager.mutation(api.bots.rotateToken, { botId })).rejects.toThrow(
        "permissions you do not hold",
      );
      // De-escalation stays possible: disabling and deleting need no ceiling.
      await manager.mutation(api.bots.update, { botId, enabled: false });
      await manager.mutation(api.bots.remove, { botId });
    });
  });

  describe("files", () => {
    it("round-trips files and stores ciphertext at rest", async () => {
      const t = newTest();
      await seedWorkspace(t);
      const botId = await createBot(t);

      await asOwner(t).mutation(api.bots.saveFiles, {
        botId,
        files: [
          { path: "lib/util.ts", content: "export const answer = 42;" },
          { path: "main.ts", content: "console.log(1);" },
        ],
        deletePaths: [],
      });

      const stored = await readFiles(t, botId);
      const util = stored.find((row) => row.path === "lib/util.ts");
      expect(util?.contentCiphertext).not.toContain("answer");
      expect(util?.contentCiphertext.startsWith("aulora-sse-")).toBe(true);

      const detail = await asOwner(t).query(api.bots.get, { botId });
      expect(detail?.files.find((file) => file.path === "lib/util.ts")?.content).toBe(
        "export const answer = 42;",
      );
      expect((await readBot(t, botId))?.revision).toBe(2);
    });

    it("deletes listed paths", async () => {
      const t = newTest();
      await seedWorkspace(t);
      const botId = await createBot(t);

      await asOwner(t).mutation(api.bots.saveFiles, {
        botId,
        files: [],
        deletePaths: ["main.ts"],
      });
      expect(await readFiles(t, botId)).toEqual([]);
    });

    it("rejects bad paths", async () => {
      const t = newTest();
      await seedWorkspace(t);
      const botId = await createBot(t);
      const badPaths = ["../evil.ts", "/abs.ts", ".hidden", "a//b.ts", "node_modules/x.ts", ""];

      for (const path of badPaths) {
        await expect(
          asOwner(t).mutation(api.bots.saveFiles, {
            botId,
            files: [{ path, content: "x" }],
            deletePaths: [],
          }),
        ).rejects.toThrow();
      }
    });

    it("enforces file count, per-file size and total size", async () => {
      const t = newTest();
      await seedWorkspace(t);
      const botId = await createBot(t);

      const many = Array.from({ length: BOT_LIMITS.maxFiles + 1 }, (_, index) => ({
        path: `f${index}.ts`,
        content: "x",
      }));
      await expect(
        asOwner(t).mutation(api.bots.saveFiles, { botId, files: many, deletePaths: [] }),
      ).rejects.toThrow(`at most ${BOT_LIMITS.maxFiles} files`);

      await expect(
        asOwner(t).mutation(api.bots.saveFiles, {
          botId,
          files: [{ path: "big.ts", content: "x".repeat(BOT_LIMITS.maxFileBytes + 1) }],
          deletePaths: [],
        }),
      ).rejects.toThrow(`at most ${BOT_LIMITS.maxFileBytes} bytes`);

      const heavy = Array.from({ length: 5 }, (_, index) => ({
        path: `heavy${index}.ts`,
        content: "x".repeat(BOT_LIMITS.maxFileBytes),
      }));
      await expect(
        asOwner(t).mutation(api.bots.saveFiles, { botId, files: heavy, deletePaths: [] }),
      ).rejects.toThrow(`at most ${BOT_LIMITS.maxTotalBytes} bytes`);
    });
  });

  describe("environment", () => {
    it("stores names only and never returns values", async () => {
      const t = newTest();
      await seedWorkspace(t);
      const botId = await createBot(t);

      await asOwner(t).mutation(api.bots.setEnv, {
        botId,
        set: [{ name: "API_KEY", value: "super-secret-value" }],
        remove: [],
      });

      const stored = await readBot(t, botId);
      expect(stored?.envCiphertext?.startsWith("aulora-sse-")).toBe(true);
      expect(stored?.envCiphertext).not.toContain("super-secret-value");

      const detail = await asOwner(t).query(api.bots.get, { botId });
      expect(detail?.envNames).toEqual(["API_KEY"]);
      expect(json(detail)).not.toContain("super-secret-value");
      expect((await readBot(t, botId))?.revision).toBe(2);
    });

    it("rejects invalid names, reserved prefixes, oversized values and too many vars", async () => {
      const t = newTest();
      await seedWorkspace(t);
      const botId = await createBot(t);

      await expect(
        asOwner(t).mutation(api.bots.setEnv, {
          botId,
          set: [{ name: "lower", value: "x" }],
          remove: [],
        }),
      ).rejects.toThrow("[A-Z_][A-Z0-9_]*");
      await expect(
        asOwner(t).mutation(api.bots.setEnv, {
          botId,
          set: [{ name: "AULORA_TOKEN", value: "x" }],
          remove: [],
        }),
      ).rejects.toThrow("AULORA_");
      await expect(
        asOwner(t).mutation(api.bots.setEnv, {
          botId,
          set: [{ name: "BIG", value: "x".repeat(BOT_LIMITS.maxEnvValueBytes + 1) }],
          remove: [],
        }),
      ).rejects.toThrow("at most");

      const many = Array.from({ length: BOT_LIMITS.maxEnvVars + 1 }, (_, index) => ({
        name: `VAR_${index}`,
        value: "x",
      }));
      await expect(
        asOwner(t).mutation(api.bots.setEnv, { botId, set: many, remove: [] }),
      ).rejects.toThrow(`at most ${BOT_LIMITS.maxEnvVars} environment variables`);
    });
  });

  describe("tokens", () => {
    it("returns a rotated token once and stores only its hash", async () => {
      const t = newTest();
      await seedWorkspace(t);
      const botId = await createBot(t);

      const rotated = await asOwner(t).mutation(api.bots.rotateToken, { botId });
      expect(rotated.token.startsWith("abt_")).toBe(true);
      expect(rotated.token).toHaveLength(47);

      const bot = await readBot(t, botId);
      expect(bot?.tokenHash).not.toBe(rotated.token);
      expect(bot?.tokenHash).toHaveLength(64);
      expect(bot?.tokenLast4).toBe(rotated.token.slice(-4));

      const detail = await asOwner(t).query(api.bots.get, { botId });
      expect(detail?.hasToken).toBe(true);
      expect(json(detail)).not.toContain(rotated.token);

      await asOwner(t).mutation(api.bots.revokeToken, { botId });
      const revoked = await readBot(t, botId);
      expect(revoked?.tokenHash).toBeUndefined();
      expect((await asOwner(t).query(api.bots.get, { botId }))?.hasToken).toBe(false);
    });
  });

  describe("remove", () => {
    it("deletes the bot, its files, logs, member rows and read states, but keeps messages", async () => {
      const t = newTest();
      await seedWorkspace(t);
      const botId = await createBot(t);
      const botUserId = (await readBot(t, botId))?.userId ?? "";
      const channelId = await seedChannel(t, {});

      await asOwner(t).mutation(api.bots.saveFiles, {
        botId,
        files: [{ path: "main.ts", content: "x" }],
        deletePaths: [],
      });
      await t.run(async (ctx) => {
        await ctx.db.insert("botLogs", {
          botId,
          stream: "stdout",
          textCiphertext: "aulora-sse-v1.1.a.b",
          at: Date.now(),
        });
        await ctx.db.insert("channelMembers", {
          channelId,
          userId: botUserId,
          joinedAt: Date.now(),
        });
        await ctx.db.insert("readStates", { userId: botUserId, channelId, mentionCount: 0 });
        await ctx.db.insert("messages", {
          channelId,
          authorId: botUserId,
          ciphertext: "plain",
          attachmentIds: [],
          mentionUserIds: [],
        });
      });

      await asOwner(t).mutation(api.bots.remove, { botId });

      expect(await readBot(t, botId)).toBeNull();
      expect(await readFiles(t, botId)).toEqual([]);
      const leftovers = await t.run(async (ctx) => {
        const logs = await ctx.db.query("botLogs").collect();
        const members = await ctx.db.query("members").collect();
        const channelMembers = await ctx.db.query("channelMembers").collect();
        const readStates = await ctx.db.query("readStates").collect();
        const messages = await ctx.db.query("messages").collect();
        return { logs, members, channelMembers, readStates, messages };
      });
      expect(leftovers.logs).toEqual([]);
      expect(leftovers.members.some((row) => row.userId === botUserId)).toBe(false);
      expect(leftovers.channelMembers.some((row) => row.userId === botUserId)).toBe(false);
      expect(leftovers.readStates.some((row) => row.userId === botUserId)).toBe(false);
      expect(leftovers.messages.some((row) => row.authorId === botUserId)).toBe(true);
      expect(
        (await readAudit(t)).some(
          (entry) => entry.action === "bot.delete" && entry.targetId === botId,
        ),
      ).toBe(true);
    });
  });

  describe("runnerStatus", () => {
    it("is offline before any heartbeat and online right after one", async () => {
      const t = newTest();
      await seedWorkspace(t);
      expect(await asOwner(t).query(api.bots.runnerStatus, {})).toEqual({
        online: false,
        lastSeenAt: null,
      });

      await t.run(async (ctx) => {
        await ctx.db.insert("botRunner", { lastSeenAt: Date.now() });
      });
      const status = await asOwner(t).query(api.bots.runnerStatus, {});
      expect(status.online).toBe(true);
      expect(status.lastSeenAt).not.toBeNull();
    });
  });
});
