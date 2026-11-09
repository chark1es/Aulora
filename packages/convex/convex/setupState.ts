import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { randomToken, sha256Hex } from "./lib/crypto";
import { addMemberRoleLink } from "./lib/memberRoles";
import { ownerIdsOf } from "./lib/owners";
import { consumeRateLimit } from "./lib/rateLimit";
import {
  canonicalSetupClaim,
  MAX_SETUP_CLAIM_ROWS,
  SETUP_TOKEN_TTL_MS,
  type SetupClaimFailure,
  setupClaimError,
  verifySetupClaim,
} from "./lib/setupToken";

/**
 * Baseline permissions granted to `@everyone`.
 *
 * Kanban is viewable and commentable by default, but editing boards and cards
 * requires an explicit Edit Kanban grant on a role (or Administrator). Owners
 * and administrators still hold every permission.
 */
const EVERYONE_PERMISSIONS: bigint =
  Permission.ViewChannel |
  Permission.SendMessages |
  Permission.SendInThreads |
  Permission.CreateThreads |
  Permission.AttachFiles |
  Permission.EmbedLinks |
  Permission.AddReactions |
  Permission.ReadHistory |
  Permission.ChangeOwnNickname |
  Permission.Connect |
  Permission.Speak |
  Permission.Stream |
  Permission.UseVideo |
  Permission.ViewKanban |
  Permission.CommentKanban |
  Permission.ViewNotes |
  Permission.CreateNotes |
  Permission.EditNotes;

/**
 * The `@everyone` baseline used before Kanban editing became an explicit grant.
 * `restrictKanbanEditing` only rewrites a role that still matches this exactly;
 * a role an owner customised is left untouched so the upgrade never discards
 * an intentional permission change.
 */
const LEGACY_EVERYONE_PERMISSIONS: bigint = EVERYONE_PERMISSIONS | Permission.EditKanban;

/** Voice bits added to the `@everyone` baseline after calling shipped. */
const VOICE_EVERYONE_BITS: bigint =
  Permission.Connect | Permission.Speak | Permission.Stream | Permission.UseVideo;

/**
 * Idempotent upgrade for workspaces created before calling existed: the stored
 * `@everyone` role predates the voice permission flags, so existing members
 * would not be able to join a call. Adds the missing bits once; a no-op when
 * they are already present. Returns whether anything changed.
 */
export const ensureVoicePermissions = internalMutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const roles = await ctx.db.query("roles").collect();
    const everyone = roles.find((role) => role.key === EVERYONE_ROLE_ID);
    if (everyone === undefined) {
      return false;
    }
    if ((VOICE_EVERYONE_BITS & ~everyone.permissions) === 0n) {
      return false;
    }
    await ctx.db.patch(everyone._id, {
      permissions: everyone.permissions | VOICE_EVERYONE_BITS,
    });
    return true;
  },
});

/** Marker recorded once, so a later intentional re-grant is not reverted. */
const KANBAN_EDITING_MIGRATION = "restrict-kanban-editing";
/** Marker for the one-time `@everyone` grant of `ViewScheduledCalls`. */
const SCHEDULED_VIEW_MIGRATION = "grant-scheduled-calls-view";

/**
 * One-time upgrade: `ViewScheduledCalls` is the one call-addon permission the
 * `@everyone` role receives, so the Scheduled tab exists for members without an
 * explicit grant. The marker means a later intentional removal is not undone.
 */
export const grantScheduledCallsView = internalMutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const server = await ctx.db.query("server").first();
    if (server?.appliedMigrations?.includes(SCHEDULED_VIEW_MIGRATION) === true) {
      return false;
    }
    const everyone = await ctx.db
      .query("roles")
      .withIndex("by_position", (q) => q.eq("position", 0))
      .first();
    let changed = false;
    if (
      everyone?.key === EVERYONE_ROLE_ID &&
      (everyone.permissions & Permission.ViewScheduledCalls) === 0n
    ) {
      await ctx.db.patch(everyone._id, {
        permissions: everyone.permissions | Permission.ViewScheduledCalls,
      });
      changed = true;
    }
    if (server !== null) {
      const applied = server.appliedMigrations ?? [];
      if (!applied.includes(SCHEDULED_VIEW_MIGRATION)) {
        await ctx.db.patch(server._id, {
          appliedMigrations: [...applied, SCHEDULED_VIEW_MIGRATION],
        });
      }
    }
    return changed;
  },
});

/**
 * One-time upgrade for workspaces created while `@everyone` could edit Kanban
 * by default. Removes Edit Kanban only from a role that still has the untouched
 * legacy baseline; a role with any custom permission is left for its owner to
 * review, so an explicit grant is never silently revoked. The migration marker
 * prevents a later deliberate re-grant from being reverted on the next deploy.
 * Returns whether anything changed.
 */

export const restrictKanbanEditing = internalMutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const server = await ctx.db.query("server").first();
    if (server?.appliedMigrations?.includes(KANBAN_EDITING_MIGRATION) === true) {
      return false;
    }
    // `@everyone` is pinned to position 0 by the role editor and `finalize`.
    const everyone = await ctx.db
      .query("roles")
      .withIndex("by_position", (q) => q.eq("position", 0))
      .first();
    let changed = false;
    if (
      everyone?.key === EVERYONE_ROLE_ID &&
      (everyone.permissions & Permission.EditKanban) !== 0n &&
      everyone.permissions === LEGACY_EVERYONE_PERMISSIONS
    ) {
      await ctx.db.patch(everyone._id, {
        permissions: everyone.permissions & ~Permission.EditKanban,
      });
      changed = true;
    }
    // Record the marker even when the role does not match: migration is a
    // one-time upgrade, not a policy re-applied on every deployment. An owner
    // who re-grants Edit Kanban later keeps it on the next deploy.
    if (server !== null) {
      const applied = server.appliedMigrations ?? [];
      if (!applied.includes(KANBAN_EDITING_MIGRATION)) {
        await ctx.db.patch(server._id, {
          appliedMigrations: [...applied, KANBAN_EDITING_MIGRATION],
        });
      }
    }
    return changed;
  },
});

/** Whether the server singleton has been created. */
export const isInitialized = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const server = await ctx.db.query("server").first();
    return server !== null;
  },
});

/** Bounded read; workspace roles are a small, admin-created set. */
const MAX_CLAIM_ROLE_ROWS = 100;

/**
 * The committed first-run claim, or `null`. Used by setup compensation to check
 * whether `finalize` actually committed before the action saw an error, so it
 * never deletes the credential that is now the owner.
 */
export const claimOutcome = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      serverId: v.id("server"),
      roleId: v.union(v.id("roles"), v.null()),
      ownerId: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const server = await ctx.db.query("server").first();
    if (server === null) {
      return null;
    }
    // Ownership is decided by the server row alone. Looking up a role by its
    // position used to make a committed claim look unclaimed whenever an owner
    // moved or deleted that role, and compensation then deleted the new owner's
    // credential. The `@everyone` key is only used to fill the legacy result
    // field; a missing role does not change the ownership answer.
    const roles = await ctx.db.query("roles").withIndex("by_position").take(MAX_CLAIM_ROLE_ROWS);
    const role = roles.find((entry) => entry.key === EVERYONE_ROLE_ID) ?? roles[0] ?? null;
    return { serverId: server._id, roleId: role?._id ?? null, ownerId: server.ownerId };
  },
});

/** The workspace access policy consulted by the Better Auth create hooks. */
export const authPolicy = internalQuery({
  args: {},
  returns: v.object({
    serverInitialized: v.boolean(),
    signupEnabled: v.boolean(),
    inviteOnly: v.boolean(),
    allowedEmailDomains: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const server = await ctx.db.query("server").first();
    return {
      serverInitialized: server !== null,
      signupEnabled: server?.settings.signupEnabled ?? true,
      inviteOnly: server?.settings.inviteOnly ?? true,
      allowedEmailDomains: server?.settings.allowedEmailDomains ?? [],
    };
  },
});

/**
 * Generates and stores a fresh first-run setup token for the setup container
 * to print once. Only the SHA-256 digest is persisted. Returns `null` when the
 * workspace is already initialized, when `SETUP_TOKEN` is configured as an
 * operator override, or (without `rotate`) when an unexpired token already
 * exists whose plaintext cannot be recovered.
 */
export const issueSetupToken = internalMutation({
  args: { rotate: v.optional(v.boolean()) },
  returns: v.object({
    token: v.union(v.string(), v.null()),
    expiresAt: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const server = await ctx.db.query("server").first();
    if (server !== null) {
      return { token: null, expiresAt: null };
    }
    if ((process.env.SETUP_TOKEN ?? "").trim().length > 0) {
      return { token: null, expiresAt: null };
    }

    const now = Date.now();
    const rows = await ctx.db.query("setupClaims").take(MAX_SETUP_CLAIM_ROWS);
    const existing = canonicalSetupClaim(rows);
    if (existing !== null && args.rotate !== true && existing.expiresAt > now) {
      await deleteExtraSetupClaims(ctx, existing._id);
      return { token: null, expiresAt: existing.expiresAt };
    }

    const token = randomToken(24);
    const expiresAt = now + SETUP_TOKEN_TTL_MS;
    const tokenHash = await sha256Hex(token);
    if (existing !== null) {
      // Reuse the canonical row so a rotate never creates a second row.
      await ctx.db.patch(existing._id, { tokenHash, createdAt: now, expiresAt });
      await deleteExtraSetupClaims(ctx, existing._id);
      return { token, expiresAt };
    }

    const insertedId = await ctx.db.insert("setupClaims", { tokenHash, createdAt: now, expiresAt });
    // Two first-run setup containers can call this at the same time. Re-read and
    // keep one deterministic row; a loser reports the winner's expiry instead of
    // returning a token whose hash it is about to delete.
    const afterInsert = await ctx.db.query("setupClaims").take(MAX_SETUP_CLAIM_ROWS);
    const winner = canonicalSetupClaim(afterInsert);
    if (winner !== null && winner._id !== insertedId) {
      await ctx.db.delete(insertedId);
      await deleteExtraSetupClaims(ctx, winner._id);
      return { token: null, expiresAt: winner.expiresAt };
    }
    await deleteExtraSetupClaims(ctx, insertedId);
    return { token, expiresAt };
  },
});

/** Keeps the deterministic canonical row and removes duplicate setup claims. */
async function deleteExtraSetupClaims(ctx: MutationCtx, keepId: string): Promise<void> {
  const rows = await ctx.db.query("setupClaims").take(MAX_SETUP_CLAIM_ROWS);
  for (const row of rows) {
    if (row._id !== keepId) {
      await ctx.db.delete(row._id);
    }
  }
}

/**
 * Attempts allowed per token bucket in one window.
 *
 * Buckets are keyed by a fixed-size hash range instead of the full token
 * fingerprint: an anonymous flood of distinct junk tokens must not create an
 * unbounded number of `rateLimits` rows. With 4096 buckets and the global
 * invalid-attempt ceiling below, a flood can touch at most a few hundred buckets
 * per window while still leaving enough spread that a real token is very
 * unlikely to share one.
 */
const SETUP_TOKEN_ATTEMPT_LIMIT = 8;
const SETUP_TOKEN_BUCKET_COUNT = 4096;
/**
 * A global cap bounds the cost of automated token guessing. It is deliberately
 * much higher than one operator needs, because the shipped reverse proxy makes
 * every caller share the same peer IP. It counts only invalid attempts, and a
 * valid token bypasses it, so an anonymous flood can never deny the operator.
 */
const SETUP_GLOBAL_ATTEMPT_LIMIT = 300;
const SETUP_CLAIM_WINDOW_MS = 15 * 60_000;
/** Individual rejection rows kept per window; later ones coalesce into a summary. */
const SETUP_REJECTION_ROW_LIMIT = 5;
/** Recent audit rows scanned when coalescing a rejection window. */
const SETUP_REJECTION_SCAN_LIMIT = 20;

/** Maps any token hash into a bounded set of per-token buckets. */
function setupTokenBucketKey(fingerprint: string): string {
  const value = Number.parseInt(fingerprint.slice(0, 8), 16);
  return `setup-claim:token:${value % SETUP_TOKEN_BUCKET_COUNT}`;
}

/**
 * A verified token's own bucket namespace. Invalid attempts use
 * {@link setupTokenBucketKey}; keeping the two apart means a flood of junk
 * tokens that happen to hash into the operator's bucket cannot exhaust the
 * counter that protects the real token. The verified counter still bounds how
 * many times one correct token can be replayed.
 */
function verifiedSetupTokenBucketKey(fingerprint: string): string {
  const value = Number.parseInt(fingerprint.slice(0, 8), 16);
  return `setup-claim:verified-token:${value % SETUP_TOKEN_BUCKET_COUNT}`;
}

/**
 * Records one rejected claim. The first few rejections in a window get their own
 * audit row; the rest update a single summary row so a flood cannot grow
 * `auditLog` without bound.
 */
async function recordClaimRejection(
  ctx: MutationCtx,
  rejection: {
    readonly reason: SetupClaimFailure | "rate_limited";
    readonly scope: "global" | "token" | "invalid";
    readonly ip: string;
  },
): Promise<void> {
  const now = Date.now();
  const windowStart = Math.floor(now / SETUP_CLAIM_WINDOW_MS) * SETUP_CLAIM_WINDOW_MS;
  const key = `setup-claim:rejected:${windowStart}`;
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const count = (existing?.count ?? 0) + 1;
  if (existing === null) {
    await ctx.db.insert("rateLimits", { key, windowStart, count });
  } else {
    await ctx.db.patch(existing._id, { count });
  }

  if (count <= SETUP_REJECTION_ROW_LIMIT) {
    await writeAudit(ctx, {
      actorId: "setup:anonymous",
      action: "setup.claim.rejected",
      meta: JSON.stringify({ reason: rejection.reason, scope: rejection.scope, ip: rejection.ip }),
    });
    return;
  }

  const recent = await ctx.db
    .query("auditLog")
    .withIndex("by_at", (q) => q.gte("at", windowStart))
    .order("desc")
    .take(SETUP_REJECTION_SCAN_LIMIT);
  const summary = recent.find((row) => row.action === "setup.claim.rejected.summary");
  const meta = JSON.stringify({
    reason: "coalesced",
    windowStart,
    count,
    lastReason: rejection.reason,
  });
  if (summary !== undefined) {
    await ctx.db.patch(summary._id, { meta });
    return;
  }
  await writeAudit(ctx, {
    actorId: "setup:anonymous",
    action: "setup.claim.rejected.summary",
    meta,
  });
}

const claimResult = v.object({
  allowed: v.boolean(),
  source: v.union(v.literal("environment"), v.literal("stored"), v.null()),
  reason: v.union(
    v.literal("initialized"),
    v.literal("rate_limited"),
    v.literal("missing"),
    v.literal("expired"),
    v.literal("invalid"),
    v.null(),
  ),
});

/**
 * Pre-flight gate for a public first-run claim: refuses an initialized
 * workspace, rate-limits attempts, and verifies the setup token before the
 * action creates any account. The same proof is re-checked atomically in
 * {@link finalize}, so a race can never create two owners.
 *
 * It returns a failure result instead of throwing so the rate-limit counter and
 * rejection audit commit. The calling action turns `allowed: false` into the
 * user-facing error.
 *
 * The counter is keyed by the attempted token's fingerprint, not the peer IP:
 * the shipped proxy terminates TLS, so every caller reaches Convex from the
 * same address and an attacker could otherwise lock out the operator with eight
 * wrong guesses.
 */
export const assertClaimAllowed = internalMutation({
  args: {
    token: v.string(),
    ip: v.string(),
  },
  returns: claimResult,
  handler: async (ctx, args) => {
    const server = await ctx.db.query("server").first();
    if (server !== null) {
      return { allowed: false, source: null, reason: "initialized" } as const;
    }

    // Verify first with a constant-time digest comparison. A valid token must
    // never be blocked by an anonymous flood that exhausted the shared global
    // ceiling; only invalid attempts consume it.
    const verification = await verifySetupClaim(ctx, args.token);
    const fingerprint = (await sha256Hex(args.token)).slice(0, 32);
    const tokenBucketKey = setupTokenBucketKey(fingerprint);

    if (!verification.ok) {
      const global = await consumeRateLimit(ctx, {
        key: "setup-claim:global",
        limit: SETUP_GLOBAL_ATTEMPT_LIMIT,
        windowMs: SETUP_CLAIM_WINDOW_MS,
      });
      if (!global.allowed) {
        console.warn(
          "setup claim rate limit tripped; the shared proxy address makes per-IP isolation unavailable",
        );
        await recordClaimRejection(ctx, {
          reason: "rate_limited",
          scope: "global",
          ip: args.ip,
        });
        return { allowed: false, source: null, reason: "rate_limited" } as const;
      }
      const tokenBucket = await consumeRateLimit(ctx, {
        key: tokenBucketKey,
        limit: SETUP_TOKEN_ATTEMPT_LIMIT,
        windowMs: SETUP_CLAIM_WINDOW_MS,
      });
      if (!tokenBucket.allowed) {
        await recordClaimRejection(ctx, {
          reason: "rate_limited",
          scope: "token",
          ip: args.ip,
        });
        return { allowed: false, source: null, reason: "rate_limited" } as const;
      }
      await recordClaimRejection(ctx, {
        reason: verification.reason,
        scope: "invalid",
        ip: args.ip,
      });
      return { allowed: false, source: null, reason: verification.reason } as const;
    }

    // A correct token has its own ceiling in a separate namespace, so a junk
    // token that collides with its bucket can never block the operator.
    const tokenBucket = await consumeRateLimit(ctx, {
      key: verifiedSetupTokenBucketKey(fingerprint),
      limit: SETUP_TOKEN_ATTEMPT_LIMIT,
      windowMs: SETUP_CLAIM_WINDOW_MS,
    });
    if (!tokenBucket.allowed) {
      await recordClaimRejection(ctx, { reason: "rate_limited", scope: "token", ip: args.ip });
      return { allowed: false, source: null, reason: "rate_limited" } as const;
    }
    return { allowed: true, source: verification.source, reason: null } as const;
  },
});

/**
 * Atomically claims a fresh instance and writes the workspace state: the
 * server singleton, the `@everyone` role and the owner member. The token check
 * and the "no server exists yet" check happen in this one mutation, so exactly
 * one concurrent claim can win. The setup token row is deleted on success.
 */
export const finalize = internalMutation({
  args: {
    name: v.string(),
    ownerId: v.string(),
    token: v.string(),
  },
  returns: v.object({
    serverId: v.id("server"),
    roleId: v.id("roles"),
    ownerId: v.string(),
  }),
  handler: async (ctx, args) => {
    const existingServer = await ctx.db.query("server").first();
    if (existingServer !== null) {
      throw new ConvexError("Server is already initialized");
    }
    const verification = await verifySetupClaim(ctx, args.token);
    if (!verification.ok) {
      throw setupClaimError(verification.reason);
    }

    const roleId = await ctx.db.insert("roles", {
      key: EVERYONE_ROLE_ID,
      name: EVERYONE_ROLE_ID,
      position: 0,
      permissions: EVERYONE_PERMISSIONS | Permission.ViewScheduledCalls,
      hoisted: false,
      mentionable: true,
    });

    const serverId = await ctx.db.insert("server", {
      name: args.name,
      iconSeed: `aulora:server:${args.ownerId}`,
      ownerId: args.ownerId,
      ownerIds: [args.ownerId],
      // The owner is the only member at bootstrap; joins/kicks keep this exact.
      memberCount: 1,
      // The reverse role index is complete for a fresh install because the
      // bootstrap owner's link is written below and later changes dual-write.
      memberRolesBackfilled: true,
      settings: {
        signupEnabled: true,
        inviteOnly: true,
        allowedEmailDomains: [],
        voiceEnabled: true,
        videoEnabled: true,
        screenShareEnabled: true,
        maxCallParticipants: 10,
      },
    });

    const existingMember = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", args.ownerId))
      .unique();
    if (existingMember === null) {
      await ctx.db.insert("members", {
        userId: args.ownerId,
        roleIds: [EVERYONE_ROLE_ID],
        joinedAt: Date.now(),
      });
    } else if (!existingMember.roleIds.includes(EVERYONE_ROLE_ID)) {
      await ctx.db.patch(existingMember._id, {
        roleIds: [...existingMember.roleIds, EVERYONE_ROLE_ID],
      });
    }
    await addMemberRoleLink(ctx, args.ownerId, EVERYONE_ROLE_ID);

    // The claim proof is one-shot: clear the stored digest (if any) once the
    // owner exists. An operator-provided SETUP_TOKEN env override stays where
    // the operator put it and is never copied into the database.
    for (const claim of await ctx.db.query("setupClaims").take(MAX_SETUP_CLAIM_ROWS)) {
      await ctx.db.delete(claim._id);
    }

    await writeAudit(ctx, {
      actorId: args.ownerId,
      action: "setup.claim",
      targetId: serverId,
      meta: JSON.stringify({ source: verification.source }),
    });

    return { serverId, roleId, ownerId: args.ownerId };
  },
});

/**
 * Idempotently records the bootstrap owner in `ownerIds` for workspaces
 * created before multiple owners existed. Readers already fall back to
 * `ownerId`, so this only completes the stored shape.
 */
export const ensureOwnerIds = internalMutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const server = await ctx.db.query("server").first();
    if (server === null || server.ownerIds !== undefined) {
      return false;
    }
    const ownerIds = ownerIdsOf(server);
    if (ownerIds.length === 0) {
      return false;
    }
    await ctx.db.patch(server._id, {
      ownerIds,
      ownerId: ownerIds[0] ?? server.ownerId,
    });
    return true;
  },
});
