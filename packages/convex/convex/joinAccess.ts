import { maskEmail, normalizeEmail } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { type MutationCtx, mutation, query } from "./_generated/server";
import { accountIdentity } from "./lib/accountNames";
import { writeAudit } from "./lib/audit";
import { requireAuth } from "./lib/auth";
import { listActiveBans } from "./lib/bans";
import { randomDigits, sha256Hex } from "./lib/crypto";
import { emailIsAllowlisted, emailTransportConfigured } from "./lib/inviteAccess";
import {
  JOIN_CODE_DIGITS,
  JOIN_CODE_MAX_ATTEMPTS,
  JOIN_CODE_REQUEST_LIMIT,
  JOIN_CODE_REQUEST_WINDOW_MS,
  JOIN_CODE_TTL_MINUTES,
} from "./lib/joinCodes";
import { admitMember } from "./lib/membership";
import { enforceRateLimit, userRateLimitKey } from "./lib/rateLimit";

/**
 * Ways a signed-in account that is not yet a member can get in without an
 * invite link: an open workspace, an allowlisted address the provider already
 * vouches for, or an allowlisted address proven by a one-time emailed code.
 */

/** Digest of a join code, salted with the account so codes cannot be shared. */
async function joinCodeHash(userId: string, code: string): Promise<string> {
  return await sha256Hex(`${userId}:${code.trim()}`);
}

/**
 * What the join screen needs to know about the caller. Safe for a non-member:
 * it only reports on the caller's own account.
 */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const server = await ctx.db.query("server").first();
    const member = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const identity = await accountIdentity(ctx, userId);
    const address = identity?.email ?? null;
    const allowlisted = await emailIsAllowlisted(ctx, address);
    return {
      isMember: member !== null || server?.ownerId === userId,
      workspaceName: server?.name ?? "Aulora",
      inviteOnly: server?.settings.inviteOnly ?? true,
      banned: (await listActiveBans(ctx, userId)).length > 0,
      allowlisted,
      emailVerified: identity?.emailVerified ?? false,
      emailHint: address !== null ? maskEmail(address) : null,
      canEmailCode: allowlisted && (await emailTransportConfigured(ctx)),
    };
  },
});

/** Joins a workspace that is not invite-only. */
export const joinOpen = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const server = await ctx.db.query("server").first();
    if (server === null || server.settings.inviteOnly) {
      throw new ConvexError("This workspace is invite only");
    }
    await admitMember(ctx, userId);
    return { joined: true };
  },
});

async function admitAllowlisted(ctx: MutationCtx, userId: string, via: string) {
  const joined = await admitMember(ctx, userId);
  if (joined) {
    await writeAudit(ctx, {
      actorId: userId,
      action: "allowlist.join",
      meta: JSON.stringify({ via }),
    });
  }
  return { joined: true, alreadyMember: !joined };
}

/** Joins with an allowlisted address the sign-in provider has already verified. */
export const joinAllowlisted = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const identity = await accountIdentity(ctx, userId);
    if (!(await emailIsAllowlisted(ctx, identity?.email))) {
      throw new ConvexError("Your email address is not on the allowlist");
    }
    if (identity?.emailVerified !== true) {
      throw new ConvexError("Verify your email address first");
    }
    return await admitAllowlisted(ctx, userId, "verified-email");
  },
});

/** Emails a one-time code to the caller's allowlisted address. */
export const requestCode = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    await enforceRateLimit(ctx, {
      key: userRateLimitKey("join-code", userId),
      limit: JOIN_CODE_REQUEST_LIMIT,
      windowMs: JOIN_CODE_REQUEST_WINDOW_MS,
    });
    const identity = await accountIdentity(ctx, userId);
    const email = identity?.email;
    if (email === null || email === undefined || !(await emailIsAllowlisted(ctx, email))) {
      throw new ConvexError("Your email address is not on the allowlist");
    }
    if (!(await emailTransportConfigured(ctx))) {
      throw new ConvexError("Email delivery is not set up. Ask an admin for an invite.");
    }
    const previous = await ctx.db
      .query("joinCodes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const row of previous) {
      await ctx.db.delete(row._id);
    }
    const code = randomDigits(JOIN_CODE_DIGITS);
    await ctx.db.insert("joinCodes", {
      userId,
      email: normalizeEmail(email),
      codeHash: await joinCodeHash(userId, code),
      expiresAt: Date.now() + JOIN_CODE_TTL_MINUTES * 60_000,
      attempts: 0,
    });
    const server = await ctx.db.query("server").first();
    await ctx.scheduler.runAfter(0, internal.email.sendJoinCode, {
      to: email,
      code,
      workspaceName: server?.name ?? "Aulora",
    });
    return { sent: true, expiresInMinutes: JOIN_CODE_TTL_MINUTES };
  },
});

type VerifyFailure = "no_code" | "expired" | "wrong_code" | "too_many_attempts" | "not_allowed";

/**
 * Checks the emailed code. A wrong guess is reported (not thrown) so the
 * attempt count survives; the code is burned after a handful of misses.
 */
export const verifyCode = mutation({
  args: { code: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ joined: true } | { joined: false; reason: VerifyFailure }> => {
    const { userId } = await requireAuth(ctx);
    const row = await ctx.db
      .query("joinCodes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (row === null) {
      return { joined: false, reason: "no_code" };
    }
    if (row.expiresAt <= Date.now()) {
      await ctx.db.delete(row._id);
      return { joined: false, reason: "expired" };
    }
    if (row.attempts >= JOIN_CODE_MAX_ATTEMPTS) {
      await ctx.db.delete(row._id);
      return { joined: false, reason: "too_many_attempts" };
    }
    if (row.codeHash !== (await joinCodeHash(userId, args.code))) {
      await ctx.db.patch(row._id, { attempts: row.attempts + 1 });
      return { joined: false, reason: "wrong_code" };
    }
    await ctx.db.delete(row._id);
    const identity = await accountIdentity(ctx, userId);
    const address = identity?.email ?? null;
    const stillTheirs = address !== null && normalizeEmail(address) === row.email;
    if (!stillTheirs || !(await emailIsAllowlisted(ctx, row.email))) {
      return { joined: false, reason: "not_allowed" };
    }
    await admitAllowlisted(ctx, userId, "email-code");
    return { joined: true };
  },
});
