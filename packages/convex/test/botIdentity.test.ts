import { BOT_JWT_AUDIENCE, BOT_JWT_ISSUER, BOT_JWT_TTL_SECONDS, Permission } from "@aulora/core";
import { exportJWK, generateKeyPair, importJWK, jwtVerify } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { botJwtConfigured, hashBotToken, signBotJwt } from "../convex/lib/botAuth";
import type { Test } from "./helpers";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

interface BotSeed {
  readonly name?: string;
  readonly enabled?: boolean;
  readonly grants?: bigint;
  readonly allowedChannelIds?: readonly Id<"channels">[];
  readonly tokenHash?: string;
  readonly hostedTokenHash?: string;
}

/** Inserts an enabled/disabled bot plus its member row and returns its ids. */
async function seedBot(
  t: Test,
  seed: BotSeed = {},
): Promise<{ botId: Id<"bots">; userId: string }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const name = seed.name ?? "helper";
    const botId = await ctx.db.insert("bots", {
      userId: "pending",
      name,
      language: "typescript",
      enabled: seed.enabled ?? true,
      grants: seed.grants ?? 0n,
      createdBy: "owner-1",
      createdAt: now,
      revision: 1,
      restartNonce: 0,
      status: "stopped",
      statusAt: now,
      ...(seed.allowedChannelIds !== undefined
        ? { allowedChannelIds: [...seed.allowedChannelIds] }
        : {}),
      ...(seed.tokenHash !== undefined ? { tokenHash: seed.tokenHash } : {}),
      ...(seed.hostedTokenHash !== undefined ? { hostedTokenHash: seed.hostedTokenHash } : {}),
    });
    const userId = `bot_${botId}`;
    await ctx.db.patch(botId, { userId });
    await ctx.db.insert("members", {
      userId,
      nickname: name,
      roleIds: [],
      joinedAt: now,
    });
    return { botId, userId };
  });
}

const SEND_GRANTS = Permission.ViewChannel | Permission.ReadHistory | Permission.SendMessages;

describe("bot permissions", () => {
  it("denies everything to a bot with no grants", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [] });
    const channelId = await seedChannel(t);
    const { userId } = await seedBot(t, { grants: 0n });
    const asBot = t.withIdentity({ subject: userId });

    const listed = await asBot.query(api.channels.list, {});
    expect(listed.page).toEqual([]);
    await expect(asBot.mutation(api.messages.send, { channelId, body: "aGk=" })).rejects.toThrow(
      "Missing permission",
    );
  });

  it("lets a granted bot send; the author is the bot user id", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [] });
    const channelId = await seedChannel(t);
    const { userId } = await seedBot(t, { grants: SEND_GRANTS });
    const asBot = t.withIdentity({ subject: userId });

    const listed = await asBot.query(api.channels.list, {});
    expect(listed.page.map((channel) => channel.id)).toEqual([channelId]);

    const messageId = await asBot.mutation(api.messages.send, { channelId, body: "aGk=" });
    const row = await t.run(async (ctx) => await ctx.db.get(messageId));
    expect(row?.authorId).toBe(userId);
  });

  it("restricts a bot to its allowed channels", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [] });
    const allowed = await seedChannel(t, { name: "allowed" });
    const blocked = await seedChannel(t, { name: "blocked" });
    const { userId } = await seedBot(t, { grants: SEND_GRANTS, allowedChannelIds: [allowed] });
    const asBot = t.withIdentity({ subject: userId });

    await asBot.mutation(api.messages.send, { channelId: allowed, body: "aGk=" });
    await expect(
      asBot.mutation(api.messages.send, { channelId: blocked, body: "aGk=" }),
    ).rejects.toThrow("Missing permission");
  });

  it("never lets a channel override exceed the bot's grants", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [] });
    const { userId } = await seedBot(t, {
      grants: Permission.ViewChannel | Permission.ReadHistory,
    });
    const channelId = await seedChannel(t, {
      overrides: [
        { targetId: userId, targetType: "member", allow: Permission.SendMessages, deny: 0n },
      ],
    });
    await expect(
      t.withIdentity({ subject: userId }).mutation(api.messages.send, { channelId, body: "aGk=" }),
    ).rejects.toThrow("Missing permission");
  });

  it("lets a channel override narrow a bot below its grants", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [] });
    const { userId } = await seedBot(t, { grants: SEND_GRANTS });
    const channelId = await seedChannel(t, {
      overrides: [
        { targetId: userId, targetType: "member", allow: 0n, deny: Permission.SendMessages },
      ],
    });
    await expect(
      t.withIdentity({ subject: userId }).mutation(api.messages.send, { channelId, body: "aGk=" }),
    ).rejects.toThrow("Missing permission");
  });

  it("rejects a disabled bot outright", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [] });
    await seedChannel(t);
    const { userId } = await seedBot(t, {
      enabled: false,
      grants: Permission.ViewChannel | Permission.ReadHistory,
    });
    await expect(t.withIdentity({ subject: userId }).query(api.channels.list, {})).rejects.toThrow(
      "Bot is disabled",
    );
  });

  it("leaves a regular member with @everyone unchanged", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });
    expect((await asUser.query(api.channels.list, {})).page.map((c) => c.id)).toEqual([channelId]);
    await expect(
      asUser.mutation(api.messages.send, { channelId, body: "aGk=" }),
    ).resolves.toBeDefined();
  });

  it("leaves the owner with all permissions", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [] });
    const channelId = await seedChannel(t);
    const asOwner = t.withIdentity({ subject: "owner-1" });
    await expect(
      asOwner.mutation(api.messages.send, { channelId, body: "aGk=" }),
    ).resolves.toBeDefined();
  });

  it("flags bots and names them from the bots table in members.list", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const { userId } = await seedBot(t, { name: "Pinger" });
    const members = await t.withIdentity({ subject: "owner-1" }).query(api.members.list, {});

    const bot = members.find((member) => member.userId === userId);
    expect(bot?.isBot).toBe(true);
    expect(bot?.accountName).toBe("Pinger");
    const human = members.find((member) => member.userId === "user-1");
    expect(human?.isBot).toBe(false);
  });
});

describe("workspace-wide reads and side effects", () => {
  it("keeps a bot with no grants out of membership-only reads", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const { userId } = await seedBot(t);
    const asBot = t.withIdentity({ subject: userId });

    await expect(asBot.query(api.members.list, {})).rejects.toThrow("Missing permission");
    await expect(asBot.query(api.categories.list, {})).rejects.toThrow("Missing permission");
    await expect(asBot.query(api.roles.list, {})).rejects.toThrow("Missing permission");
  });

  it("lets a bot with ViewChannel read the roster, and marks bots in it", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const { userId } = await seedBot(t, { grants: Permission.ViewChannel });
    const asBot = t.withIdentity({ subject: userId });

    const members = await asBot.query(api.members.list, {});
    expect(members.find((member) => member.userId === userId)?.isBot).toBe(true);
    expect(members.find((member) => member.userId === "user-1")?.isBot).toBe(false);
  });

  it("stops a disabled bot from browsing even with ViewChannel", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const { userId } = await seedBot(t, { grants: Permission.ViewChannel, enabled: false });

    await expect(t.withIdentity({ subject: userId }).query(api.members.list, {})).rejects.toThrow();
  });

  it("never lets a bot start a DM or upload an avatar, whatever it was granted", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const { userId } = await seedBot(t, { grants: SEND_GRANTS });
    const asBot = t.withIdentity({ subject: userId });

    await expect(asBot.mutation(api.channels.createDm, { otherUserId: "user-1" })).rejects.toThrow(
      "Bots cannot",
    );
    await expect(
      asBot.mutation(api.channels.createGroupDm, { memberIds: ["user-1"] }),
    ).rejects.toThrow("Bots cannot");
    await expect(asBot.mutation(api.members.generateAvatarUploadUrl, {})).rejects.toThrow(
      "Bots cannot",
    );
  });

  it("still lets a person start a DM with a bot", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const { userId } = await seedBot(t, { grants: SEND_GRANTS });

    const dm = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.channels.createDm, { otherUserId: userId });
    expect(dm).toBeDefined();
  });
});

describe("bot JWT", () => {
  it("signs an ES256 token that verifies with the public JWK", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    const privateJwk = { ...(await exportJWK(privateKey)), kid: "test-kid" };
    const publicJwk = { ...(await exportJWK(publicKey)), kid: "test-kid" };
    const now = Date.now();

    const signed = await signBotJwt(
      { userId: "bot_abc", now },
      { BOT_JWT_PRIVATE_JWK: JSON.stringify(privateJwk) },
    );
    const { payload, protectedHeader } = await jwtVerify(
      signed.token,
      await importJWK(publicJwk, "ES256"),
      { issuer: BOT_JWT_ISSUER, audience: BOT_JWT_AUDIENCE },
    );

    expect(protectedHeader.alg).toBe("ES256");
    expect(protectedHeader.kid).toBe("test-kid");
    expect(payload.sub).toBe("bot_abc");
    expect(payload.iss).toBe(BOT_JWT_ISSUER);
    expect(payload.aud).toBe(BOT_JWT_AUDIENCE);
    expect(payload.iat).toBe(Math.floor(now / 1000));
    expect(payload.exp).toBe(Math.floor(now / 1000) + BOT_JWT_TTL_SECONDS);
    expect(signed.expiresAt).toBe(payload.exp ? payload.exp * 1000 : 0);
  });

  it("refuses to sign without a configured key", async () => {
    expect(botJwtConfigured({})).toBe(false);
    await expect(signBotJwt({ userId: "bot_abc" }, { BOT_JWT_PRIVATE_JWK: "" })).rejects.toThrow();
  });
});

describe("bots not counted as seats", () => {
  it("never records a bot login toward monthly active users", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [] });
    const { userId } = await seedBot(t, { grants: SEND_GRANTS });
    const now = Date.UTC(2026, 9, 12);
    await t.run(async (ctx) => {
      const server = await ctx.db.query("server").first();
      if (!server) throw new Error("Missing server");
      await ctx.db.patch(server._id, {
        licenseKey: `AULORA2_${"a".repeat(43)}`,
        licenseValidation: {
          keyHash: "hash",
          licenseId: "license-1",
          billingModel: "monthly-active-users",
          state: "active",
          tier: "commercial",
          licensee: "Acme",
          issuedAt: now,
          expiresAt: now + 40 * 86400000,
          checkedAt: now,
          validUntil: now + 40 * 86400000,
          note: "valid",
          tags: [],
          seats: 1,
        },
      });
    });
    await t.mutation(internal.licenseUsage.recordLogin, { userId });
    expect(await t.run(async (ctx) => await ctx.db.query("licenseActivity").collect())).toEqual([]);
  });
});

describe("POST /bots/token", () => {
  let privateJwkJson: string;
  let publicJwkJson: string;
  const originalPrivate = process.env.BOT_JWT_PRIVATE_JWK;

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    privateJwkJson = JSON.stringify({ ...(await exportJWK(privateKey)), kid: "test-kid" });
    publicJwkJson = JSON.stringify({ ...(await exportJWK(publicKey)), kid: "test-kid" });
  });

  beforeEach(() => {
    process.env.BOT_JWT_PRIVATE_JWK = privateJwkJson;
  });
  afterEach(() => {
    if (originalPrivate === undefined) {
      delete process.env.BOT_JWT_PRIVATE_JWK;
    } else {
      process.env.BOT_JWT_PRIVATE_JWK = originalPrivate;
    }
  });

  function exchange(t: Test, token: string): Promise<Response> {
    return t.fetch("/bots/token", {
      method: "POST",
      headers: { Authorization: `Bot ${token}` },
    });
  }

  it("returns 503 when the JWT key is missing", async () => {
    delete process.env.BOT_JWT_PRIVATE_JWK;
    const t = newTest();
    const response = await exchange(t, "abt_unknown");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "bots_unavailable" });
  });

  it("returns 401 for an unknown token or a bad scheme", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [] });
    const unknown = await exchange(t, "abt_unknown");
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual({ error: "invalid_token" });

    const badScheme = await t.fetch("/bots/token", {
      method: "POST",
      headers: { Authorization: "Bearer nope" },
    });
    expect(badScheme.status).toBe(401);
  });

  it("returns 403 for a disabled bot", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [] });
    const token = "abt_disabled";
    await seedBot(t, { enabled: false, tokenHash: await hashBotToken(token) });
    const response = await exchange(t, token);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "bot_disabled" });
  });

  it("exchanges an external token for a verifiable JWT", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [] });
    const token = "abt_external";
    const { userId, botId } = await seedBot(t, {
      name: "Pinger",
      tokenHash: await hashBotToken(token),
    });

    const response = await exchange(t, token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      token: string;
      expiresAt: number;
      userId: string;
      botId: string;
      name: string;
    };
    expect(body).toMatchObject({ userId, botId, name: "Pinger" });
    expect(body.expiresAt).toBeGreaterThan(Date.now());
    const { payload } = await jwtVerify(
      body.token,
      await importJWK(JSON.parse(publicJwkJson), "ES256"),
      { issuer: BOT_JWT_ISSUER, audience: BOT_JWT_AUDIENCE },
    );
    expect(payload.sub).toBe(userId);
  });

  it("accepts the runner-injected hosted token too", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [] });
    const token = "abt_hosted";
    const { userId } = await seedBot(t, { hostedTokenHash: await hashBotToken(token) });
    const response = await exchange(t, token);
    expect(response.status).toBe(200);
    expect((await response.json()) as { userId: string }).toMatchObject({ userId });
  });

  it("rate limits a token hash to 60 exchanges per minute", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [] });
    const token = "abt_limited";
    const tokenHash = await hashBotToken(token);
    await seedBot(t, { tokenHash });
    await t.run(async (ctx) => {
      await ctx.db.insert("rateLimits", {
        key: `bot-token:${tokenHash}`,
        windowStart: Date.now(),
        count: 60,
      });
    });
    const response = await exchange(t, token);
    expect(response.status).toBe(429);
  });
});
