import {
  hasPermission,
  type InviteKind,
  isValidEmail,
  maskEmail,
  normalizeEmail,
  normalizeInviteCode,
  Permission,
} from "@aulora/core";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, type QueryCtx, query } from "./_generated/server";
import { accountIdentity, accountNames } from "./lib/accountNames";
import { writeAudit } from "./lib/audit";
import { requireAuth } from "./lib/auth";
import { assertNotBanned } from "./lib/bans";
import { randomAccessCode, randomToken, sha256Hex } from "./lib/crypto";
import { parseEmailConfig } from "./lib/email";
import { type InviteStatus, inviteStatus } from "./lib/inviteState";
import { admitMember } from "./lib/membership";
import { requireWorkspaceContext, requireWorkspacePermission } from "./lib/permissions";
import { enforceRateLimit, userRateLimitKey } from "./lib/rateLimit";

/** Default invite lifetime: one week. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Longest note an admin can attach to an invite. */
const NOTE_MAX_LENGTH = 80;

/** Largest finite use limit; anything beyond is what "unlimited" is for. */
const MAX_USES_CEILING = 100_000;

/** How many recent joins each invite carries in the admin list. */
const REDEMPTIONS_SHOWN = 10;

function positive(raw: string | undefined, fallback: number): number {
  const configured = Number(raw);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

/** Per-actor invite mint budget, overridable per deployment. */
const inviteRateLimit = () => positive(process.env.INVITE_RATE_LIMIT, 20);
const inviteRateWindowMs = () => positive(process.env.INVITE_RATE_WINDOW_MS, 60_000);

/** Cap on a creator's live (unused, unexpired, unrevoked) invites. */
const pendingInviteLimit = () => positive(process.env.INVITE_PENDING_LIMIT, 50);

/** Redeem attempts per person per window; short codes must not be guessable. */
const redeemRateLimit = () => positive(process.env.INVITE_REDEEM_RATE_LIMIT, 10);
const redeemRateWindowMs = () => positive(process.env.INVITE_REDEEM_RATE_WINDOW_MS, 10 * 60_000);

/** Rejects the create when email is requested but no transport is set up. */
async function assertInviteEmailConfigured(
  ctx: Parameters<typeof requireWorkspacePermission>[0],
): Promise<void> {
  const siteUrl = (process.env.SITE_URL?.trim() ?? "") || process.env.CONVEX_SITE_URL?.trim();
  if (!siteUrl) throw new ConvexError("Set SITE_URL before emailing invites");
  const configured = await ctx.db.query("emailSettings").first();
  if ((configured?.provider ?? parseEmailConfig().provider) === "none") {
    throw new ConvexError("Configure email delivery before emailing invites");
  }
}

/** Caps a creator's live invites so one actor cannot mint unbounded links. */
async function assertPendingInviteBudget(
  ctx: Parameters<typeof requireWorkspacePermission>[0],
  userId: string,
  now: number,
): Promise<void> {
  const existingInvites = await ctx.db
    .query("invites")
    .withIndex("by_creator", (q) => q.eq("createdBy", userId))
    .collect();
  const pending = existingInvites.filter((invite) => inviteStatus(invite, now) === "active");
  if (pending.length >= pendingInviteLimit()) {
    throw new ConvexError("Too many pending invites");
  }
}

interface CreateArgs {
  readonly kind?: InviteKind | undefined;
  readonly maxUses?: number | undefined;
  readonly expiresAt?: number | null | undefined;
  readonly email?: string | undefined;
  readonly note?: string | undefined;
}

interface InviteSpec {
  readonly kind: InviteKind;
  readonly maxUses: number;
  /** Absent means the invite never expires. */
  readonly expiresAt: number | undefined;
  readonly restrictedEmail: string | undefined;
  readonly note: string | undefined;
}

function resolveMaxUses(kind: InviteKind, requested: number | undefined): number {
  if (kind === "email") {
    return 1;
  }
  const maxUses = requested ?? (kind === "code" ? 1 : 0);
  if (!Number.isInteger(maxUses) || maxUses < 0 || maxUses > MAX_USES_CEILING) {
    throw new ConvexError("Use limit must be a whole number, or 0 for unlimited");
  }
  return maxUses;
}

function resolveExpiry(requested: number | null | undefined, now: number): number | undefined {
  if (requested === null) {
    return undefined;
  }
  if (requested !== undefined && requested <= now) {
    throw new ConvexError("expiresAt must be in the future");
  }
  return requested ?? now + INVITE_TTL_MS;
}

/**
 * Validates a create request into the shape that is stored. `email` is the
 * person the invite is for: a `link` or `code` invite with an address is
 * limited to that account, and an `email` invite is also sent there and can be
 * used exactly once.
 */
function resolveSpec(args: CreateArgs, now: number): InviteSpec {
  const recipient = args.email?.trim();
  const hasRecipient = recipient !== undefined && recipient.length > 0;
  const kind = args.kind ?? (hasRecipient ? "email" : "link");
  if (hasRecipient && !isValidEmail(recipient)) {
    throw new ConvexError("Invite email is not a valid address");
  }
  if (kind === "email" && !hasRecipient) {
    throw new ConvexError("Enter the email address to send the invite to");
  }
  const note = args.note?.trim();
  if (note !== undefined && note.length > NOTE_MAX_LENGTH) {
    throw new ConvexError(`Notes can be at most ${NOTE_MAX_LENGTH} characters`);
  }
  return {
    kind,
    maxUses: resolveMaxUses(kind, args.maxUses),
    expiresAt: resolveExpiry(args.expiresAt, now),
    restrictedEmail: hasRecipient ? normalizeEmail(recipient) : undefined,
    note: note !== undefined && note.length > 0 ? note : undefined,
  };
}

/** Looks an invite up by whatever the person pasted or typed. */
async function findInviteByCode(ctx: QueryCtx, input: string): Promise<Doc<"invites"> | null> {
  const codeHash = await sha256Hex(normalizeInviteCode(input));
  return await ctx.db
    .query("invites")
    .withIndex("by_code", (q) => q.eq("code", codeHash))
    .unique();
}

interface RedemptionView {
  readonly userId: string;
  readonly name: string | null;
  readonly at: number;
}

interface InviteView {
  readonly id: Doc<"invites">["_id"];
  readonly kind: InviteKind;
  readonly status: InviteStatus;
  readonly createdBy: string;
  readonly createdByName: string | null;
  readonly note: string | null;
  readonly codeHint: string | null;
  readonly restrictedEmail: string | null;
  readonly emailStatus: "queued" | "sent" | "failed" | null;
  readonly maxUses: number;
  readonly uses: number;
  readonly expiresAt: number | null;
  readonly revokedAt: number | null;
  readonly createdAt: number;
  readonly redemptions: readonly RedemptionView[];
}

function toInviteView(
  invite: Doc<"invites">,
  now: number,
  names: ReadonlyMap<string, string | null>,
  redemptions: readonly Doc<"inviteRedemptions">[],
): InviteView {
  return {
    id: invite._id,
    kind: invite.kind ?? "link",
    status: inviteStatus(invite, now),
    createdBy: invite.createdBy,
    createdByName: names.get(invite.createdBy) ?? null,
    note: invite.note ?? null,
    codeHint: invite.codeHint ?? null,
    restrictedEmail: invite.restrictedEmail ?? null,
    emailStatus: invite.emailStatus ?? null,
    maxUses: invite.maxUses,
    uses: invite.uses,
    expiresAt: invite.expiresAt ?? null,
    revokedAt: invite.revokedAt ?? null,
    createdAt: invite._creationTime,
    redemptions: redemptions.map((row) => ({
      userId: row.userId,
      name: names.get(row.userId) ?? null,
      at: row.at,
    })),
  };
}

/**
 * Creates an invite. The plaintext code is returned exactly once and only its
 * SHA-256 digest is stored, so a database read cannot reconstruct a working
 * link. `maxUses` of 0 means unlimited; `expiresAt` of `null` means the invite
 * never expires (omit it for the default week). Requires `CreateInvites`.
 */
export const create = mutation({
  args: {
    kind: v.optional(v.union(v.literal("link"), v.literal("email"), v.literal("code"))),
    maxUses: v.optional(v.number()),
    expiresAt: v.optional(v.union(v.number(), v.null())),
    email: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(ctx, Permission.CreateInvites);
    await enforceRateLimit(ctx, {
      key: userRateLimitKey("invite", userId),
      limit: inviteRateLimit(),
      windowMs: inviteRateWindowMs(),
    });
    const now = Date.now();
    const spec = resolveSpec(args, now);
    if (spec.kind === "email") {
      await assertInviteEmailConfigured(ctx);
    }
    await assertPendingInviteBudget(ctx, userId, now);

    const code = spec.kind === "code" ? randomAccessCode() : randomToken();
    const codeHash = await sha256Hex(normalizeInviteCode(code));
    const inviteId = await ctx.db.insert("invites", {
      code: codeHash,
      createdBy: userId,
      maxUses: spec.maxUses,
      uses: 0,
      kind: spec.kind,
      codeHint: code.slice(-4),
      ...(spec.expiresAt !== undefined ? { expiresAt: spec.expiresAt } : {}),
      ...(spec.restrictedEmail !== undefined ? { restrictedEmail: spec.restrictedEmail } : {}),
      ...(spec.note !== undefined ? { note: spec.note } : {}),
      ...(spec.kind === "email" ? { emailStatus: "queued" as const } : {}),
    });
    if (spec.kind === "email" && spec.restrictedEmail !== undefined) {
      const server = await ctx.db.query("server").first();
      const invitedByName = (await accountNames(ctx, [userId])).get(userId) ?? undefined;
      await ctx.scheduler.runAfter(0, internal.email.sendInvite, {
        inviteId,
        to: spec.restrictedEmail,
        code,
        workspaceName: server?.name ?? "Aulora",
        ...(invitedByName !== undefined ? { invitedByName } : {}),
        ...(spec.expiresAt !== undefined ? { expiresAt: spec.expiresAt } : {}),
      });
    }
    await writeAudit(ctx, {
      actorId: userId,
      action: "invite.create",
      targetId: inviteId,
      meta: JSON.stringify({
        kind: spec.kind,
        maxUses: spec.maxUses,
        expiresAt: spec.expiresAt ?? null,
        email: spec.restrictedEmail ?? null,
        note: spec.note ?? null,
      }),
    });
    return { inviteId, code, kind: spec.kind };
  },
});

/** Records whether the invite email left the building; set by the send action. */
export const markEmailResult = internalMutation({
  args: { inviteId: v.id("invites"), sent: v.boolean() },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId);
    if (invite !== null) {
      await ctx.db.patch(args.inviteId, { emailStatus: args.sent ? "sent" : "failed" });
    }
    return null;
  },
});

interface InspectResult {
  readonly valid: boolean;
  readonly workspaceName: string;
  readonly expiresAt: number | null;
  readonly reason?: "not_found" | "revoked" | "expired" | "exhausted";
  /** A masked hint of the one address the invite is for, when it has one. */
  readonly restrictedTo?: string;
}

/**
 * Public, unauthenticated invite check for the join page. Never reveals the
 * code or any member data; it reports whether the link still works, and for an
 * invite tied to one address, a masked hint of whose it is.
 */
export const inspect = query({
  args: { code: v.string() },
  handler: async (ctx, args): Promise<InspectResult> => {
    const server = await ctx.db.query("server").first();
    const workspaceName = server?.name ?? "Aulora";
    const invite = await findInviteByCode(ctx, args.code);
    if (invite === null) {
      return { valid: false, workspaceName, expiresAt: null, reason: "not_found" };
    }
    const status = inviteStatus(invite, Date.now());
    return {
      valid: status === "active",
      workspaceName,
      expiresAt: invite.expiresAt ?? null,
      ...(status !== "active" ? { reason: status } : {}),
      ...(invite.restrictedEmail !== undefined
        ? { restrictedTo: maskEmail(invite.restrictedEmail) }
        : {}),
    };
  },
});

/**
 * Paginated invite history (never the code): who made each invite, how it was
 * sent, its limits and who has joined with it. Requires `CreateInvites` or
 * `DeleteInvites`.
 */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { permissions } = await requireWorkspaceContext(ctx);
    if (
      !hasPermission(permissions, Permission.CreateInvites) &&
      !hasPermission(permissions, Permission.DeleteInvites)
    ) {
      throw new ConvexError("Missing permission");
    }
    const result = await ctx.db.query("invites").order("desc").paginate(args.paginationOpts);
    const redemptionRows = await Promise.all(
      result.page.map((invite) =>
        ctx.db
          .query("inviteRedemptions")
          .withIndex("by_invite", (q) => q.eq("inviteId", invite._id))
          .order("desc")
          .take(REDEMPTIONS_SHOWN),
      ),
    );
    const names = await accountNames(ctx, [
      ...result.page.map((invite) => invite.createdBy),
      ...redemptionRows.flatMap((rows) => rows.map((row) => row.userId)),
    ]);
    const now = Date.now();
    return {
      ...result,
      page: result.page.map((invite, index) =>
        toInviteView(invite, now, names, redemptionRows.at(index) ?? []),
      ),
    };
  },
});

/** Disables an invite so it can no longer be redeemed. Requires `DeleteInvites`. */
export const revoke = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(ctx, Permission.DeleteInvites);
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
 * Deletes an invite and its join history. The audit log keeps the record of
 * who made and removed it. Requires `DeleteInvites`.
 */
export const remove = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(ctx, Permission.DeleteInvites);
    const invite = await ctx.db.get(args.inviteId);
    if (invite === null) {
      throw new ConvexError("Invite not found");
    }
    const joins = await ctx.db
      .query("inviteRedemptions")
      .withIndex("by_invite", (q) => q.eq("inviteId", args.inviteId))
      .collect();
    for (const join of joins) {
      await ctx.db.delete(join._id);
    }
    await ctx.db.delete(args.inviteId);
    await writeAudit(ctx, {
      actorId: userId,
      action: "invite.delete",
      targetId: args.inviteId,
      meta: JSON.stringify({ kind: invite.kind ?? "link", createdBy: invite.createdBy }),
    });
    return { deleted: true };
  },
});

type RedeemFailure = "not_found" | "revoked" | "expired" | "exhausted" | "wrong_account";

const REDEEM_FAILURE_MESSAGES = new Map<RedeemFailure, string>([
  ["not_found", "Invite not found"],
  ["revoked", "Invite has been revoked"],
  ["expired", "Invite has expired"],
  ["exhausted", "Invite has reached its maximum uses"],
  ["wrong_account", "This invite was issued to a different email address"],
]);

/**
 * A refusal is returned, not thrown: a thrown error rolls the mutation back,
 * which would also discard the rate-limit count for the bad guess.
 */
function refused(reason: RedeemFailure) {
  return { joined: false as const, reason, message: REDEEM_FAILURE_MESSAGES.get(reason) ?? "" };
}

/** An invite tied to one address only works for the account that owns it. */
async function addressMatches(
  ctx: Parameters<typeof accountIdentity>[0],
  invite: Doc<"invites">,
  userId: string,
): Promise<boolean> {
  if (invite.restrictedEmail === undefined) {
    return true;
  }
  const address = (await accountIdentity(ctx, userId))?.email;
  return (
    address !== null && address !== undefined && normalizeEmail(address) === invite.restrictedEmail
  );
}

/**
 * Redeems an invite code for the signed-in user: creates their member row
 * carrying `@everyone` and counts one use. Accepts the link token, a typed
 * access code or a whole pasted link. Idempotent — a caller who is already a
 * member joins again without consuming another use. A revoked, expired,
 * exhausted, unknown or wrong-address code comes back as `joined: false` with
 * a reason; a banned account throws. Attempts are capped per person.
 */
export const redeem = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await enforceRateLimit(ctx, {
      key: userRateLimitKey("invite-redeem", userId),
      limit: redeemRateLimit(),
      windowMs: redeemRateWindowMs(),
    });
    const invite = await findInviteByCode(ctx, args.code);
    if (invite === null) {
      return refused("not_found");
    }
    const status = inviteStatus(invite, Date.now());
    if (status === "revoked" || status === "expired") {
      return refused(status);
    }

    await assertNotBanned(ctx, userId);
    const isMember =
      (await ctx.db
        .query("members")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique()) !== null;
    if (isMember) {
      return { joined: true as const, alreadyMember: true };
    }
    if (status === "exhausted") {
      return refused("exhausted");
    }
    if (!(await addressMatches(ctx, invite, userId))) {
      return refused("wrong_account");
    }

    await admitMember(ctx, userId);
    await ctx.db.patch(invite._id, { uses: invite.uses + 1 });
    await ctx.db.insert("inviteRedemptions", {
      inviteId: invite._id,
      userId,
      at: Date.now(),
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "invite.redeem",
      targetId: invite._id,
    });
    return { joined: true as const, alreadyMember: false };
  },
});
