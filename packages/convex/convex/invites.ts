import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireAuth } from "./lib/auth";
import { randomToken, sha256Hex } from "./lib/crypto";
import { requireWorkspacePermission } from "./lib/permissions";

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
  args: { maxUses: v.optional(v.number()), expiresAt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(ctx, Permission.CreateInvites);
    const maxUses = args.maxUses ?? 0;
    if (maxUses < 0) {
      throw new ConvexError("maxUses cannot be negative");
    }
    if (args.expiresAt !== undefined && args.expiresAt <= Date.now()) {
      throw new ConvexError("expiresAt must be in the future");
    }

    const code = randomToken();
    const codeHash = await sha256Hex(code);
    const inviteId = await ctx.db.insert("invites", {
      code: codeHash,
      createdBy: userId,
      maxUses,
      uses: 0,
      ...(args.expiresAt !== undefined ? { expiresAt: args.expiresAt } : {}),
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "invite.create",
      targetId: inviteId,
      meta: JSON.stringify({ maxUses, expiresAt: args.expiresAt ?? null }),
    });
    return { inviteId, code };
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

    const banned = await ctx.db
      .query("bans")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (banned !== null) {
      throw new ConvexError("You are banned from this workspace");
    }

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
