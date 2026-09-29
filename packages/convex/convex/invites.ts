import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { accountNames } from "./lib/accountNames";
import { writeAudit } from "./lib/audit";
import { requireAuth } from "./lib/auth";
import { assertNotBanned } from "./lib/bans";
import { randomToken, sha256Hex } from "./lib/crypto";
import { requireWorkspacePermission } from "./lib/permissions";
import { enforceRateLimit, userRateLimitKey } from "./lib/rateLimit";

/** Default invite lifetime: one week. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Per-actor invite mint budget, overridable per deployment. */
function inviteRateLimit(): number {
  const configured = Number(process.env.INVITE_RATE_LIMIT);
  return Number.isFinite(configured) && configured > 0 ? configured : 20;
}

function inviteRateWindowMs(): number {
  const configured = Number(process.env.INVITE_RATE_WINDOW_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 60_000;
}

/** Cap on a creator's live (unused, unexpired, unrevoked) invites. */
function pendingInviteLimit(): number {
  const configured = Number(process.env.INVITE_PENDING_LIMIT);
  return Number.isFinite(configured) && configured > 0 ? configured : 50;
}

/** Deliberately permissive: a single `@`, a dot in the domain, no spaces. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface InviteView {
  readonly id: Doc<"invites">["_id"];
  readonly createdBy: string;
  readonly maxUses: number;
  readonly uses: number;
  readonly expiresAt: number | null;
  readonly revokedAt: number | null;
  readonly createdAt: number;
}

function toInviteView(invite: Doc<"invites">): InviteView {
  return {
    id: invite._id,
    createdBy: invite.createdBy,
    maxUses: invite.maxUses,
    uses: invite.uses,
    expiresAt: invite.expiresAt ?? null,
    revokedAt: invite.revokedAt ?? null,
    createdAt: invite._creationTime,
  };
}

/**
 * Creates an invite. The plaintext code is returned exactly once and only its
 * SHA-256 digest is stored, so a database read cannot reconstruct a working
 * link. `maxUses` of 0 means unlimited. Requires `CreateInvites`.
 */
export const create = mutation({
  args: {
    maxUses: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(ctx, Permission.CreateInvites);
    await enforceRateLimit(ctx, {
      key: userRateLimitKey("invite", userId),
      limit: inviteRateLimit(),
      windowMs: inviteRateWindowMs(),
    });
    const maxUses = args.maxUses ?? 0;
    if (maxUses < 0) {
      throw new ConvexError("maxUses cannot be negative");
    }
    const now = Date.now();
    if (args.expiresAt !== undefined && args.expiresAt <= now) {
      throw new ConvexError("expiresAt must be in the future");
    }
    const expiresAt = args.expiresAt ?? now + INVITE_TTL_MS;

    const recipient = args.email?.trim();
    if (recipient !== undefined && recipient.length > 0 && !EMAIL_PATTERN.test(recipient)) {
      throw new ConvexError("Invite email is not a valid address");
    }

    // Cap the creator's live invites so one actor cannot mint unbounded links
    // (each may trigger an outbound email).
    const existingInvites = await ctx.db.query("invites").collect();
    const pending = existingInvites.filter(
      (invite) =>
        invite.createdBy === userId &&
        invite.revokedAt === undefined &&
        (invite.expiresAt === undefined || invite.expiresAt > now) &&
        (invite.maxUses === 0 || invite.uses < invite.maxUses),
    );
    if (pending.length >= pendingInviteLimit()) {
      throw new ConvexError("Too many pending invites");
    }

    const code = randomToken();
    const codeHash = await sha256Hex(code);
    const inviteId = await ctx.db.insert("invites", {
      code: codeHash,
      createdBy: userId,
      maxUses,
      uses: 0,
      expiresAt,
    });
    if (recipient !== undefined && recipient.length > 0) {
      const server = await ctx.db.query("server").first();
      const invitedByName = (await accountNames(ctx, [userId])).get(userId) ?? undefined;
      await ctx.scheduler.runAfter(0, internal.email.sendInvite, {
        to: recipient,
        code,
        workspaceName: server?.name ?? "Aulora",
        ...(invitedByName !== undefined && invitedByName !== null ? { invitedByName } : {}),
      });
    }
    await writeAudit(ctx, {
      actorId: userId,
      action: "invite.create",
      targetId: inviteId,
      meta: JSON.stringify({ maxUses, expiresAt, email: recipient ?? null }),
    });
    return { inviteId, code };
  },
});

/**
 * Public, unauthenticated invite check for the join page. Never reveals the
 * code or any member data; it only reports whether the link still works.
 */
export const inspect = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const server = await ctx.db.query("server").first();
    const workspaceName = server?.name ?? "Aulora";
    const codeHash = await sha256Hex(args.code);
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_code", (q) => q.eq("code", codeHash))
      .unique();
    if (invite === null) {
      return { valid: false, workspaceName, expiresAt: null, reason: "not_found" };
    }
    if (invite.revokedAt !== undefined) {
      return {
        valid: false,
        workspaceName,
        expiresAt: invite.expiresAt ?? null,
        reason: "revoked",
      };
    }
    if (invite.expiresAt !== undefined && invite.expiresAt <= Date.now()) {
      return {
        valid: false,
        workspaceName,
        expiresAt: invite.expiresAt,
        reason: "expired",
      };
    }
    if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
      return {
        valid: false,
        workspaceName,
        expiresAt: invite.expiresAt ?? null,
        reason: "exhausted",
      };
    }
    return {
      valid: true,
      workspaceName,
      expiresAt: invite.expiresAt ?? null,
    };
  },
});

/** Paginated invite metadata (never the code). Requires `CreateInvites`. */
export const list = query({
  args: { paginationOpts: v.optional(paginationOptsValidator) },
  handler: async (ctx, args) => {
    await requireWorkspacePermission(ctx, Permission.CreateInvites);
    const result = await ctx.db
      .query("invites")
      .order("desc")
      .paginate(args.paginationOpts ?? { numItems: 50, cursor: null });
    return { ...result, page: result.page.map(toInviteView) };
  },
});

/** Revokes an invite so it can no longer be redeemed. Requires `CreateInvites`. */
export const revoke = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(ctx, Permission.CreateInvites);
    const invite = await ctx.db.get(args.inviteId);
    if (invite === null) {
      throw new ConvexError("Invite not found");
    }
    if (invite.revokedAt === undefined) {
      await ctx.db.patch(args.inviteId, { revokedAt: Date.now() });
      await writeAudit(ctx, {
        actorId: userId,
        action: "invite.revoke",
        targetId: args.inviteId,
      });
    }
    return { revoked: true };
  },
});

/**
 * Redeems a plaintext invite code for the signed-in user: creates their member
 * row carrying `@everyone` and counts one use. Idempotent — a caller who is
 * already a member joins again without consuming another use. Rejects revoked,
 * expired, exhausted or banned codes. The code is hashed before lookup.
 */
export const redeem = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const codeHash = await sha256Hex(args.code);
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_code", (q) => q.eq("code", codeHash))
      .unique();
    if (invite === null) {
      throw new ConvexError("Invite not found");
    }
    if (invite.revokedAt !== undefined) {
      throw new ConvexError("Invite has been revoked");
    }
    if (invite.expiresAt !== undefined && invite.expiresAt <= Date.now()) {
      throw new ConvexError("Invite has expired");
    }

    await assertNotBanned(ctx, userId);

    const existing = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing !== null) {
      return { joined: true, alreadyMember: true };
    }

    if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
      throw new ConvexError("Invite has reached its maximum uses");
    }

    await ctx.db.insert("members", {
      userId,
      roleIds: [EVERYONE_ROLE_ID],
      joinedAt: Date.now(),
    });
    await ctx.db.patch(invite._id, { uses: invite.uses + 1 });
    await writeAudit(ctx, {
      actorId: userId,
      action: "invite.redeem",
      targetId: invite._id,
    });
    return { joined: true, alreadyMember: false };
  },
});
