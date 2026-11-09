import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { constantTimeEqual, randomToken, sha256Hex } from "./lib/crypto";
import {
  NATIVE_AUTH_FINISH_PER_TX,
  NATIVE_AUTH_RATE_WINDOW_MS,
  NATIVE_AUTH_TX_TTL_MS,
} from "./lib/nativeAuth";
import { consumeRateLimit } from "./lib/rateLimit";
import { openString, sealString } from "./lib/sse";

/**
 * One-time OAuth handoff codes for native and desktop clients.
 *
 * The code itself is random and opaque (256 bits). Only its SHA-256 digest is
 * stored, together with the PKCE-style challenge the client sent at
 * `native/start`, the workspace origin, and the session token sealed with the
 * server-side `aulora-sse-v1` envelope. The route layer never stores or logs
 * the plaintext code, and the session token is never written in plaintext.
 *
 * Rows are consumed by deleting them in the same mutation that checks the
 * verifier, so Convex's optimistic concurrency makes the exchange exactly
 * once: a replay either finds no row or retries and then finds no row.
 */

/** How long a minted code stays valid. */
export const HANDOFF_CODE_TTL_MS = 2 * 60 * 1000;

/** Random bytes in a code; 32 bytes is 256 bits, well above the 192-bit floor. */
const CODE_BYTES = 32;

/** Expired rows dropped per cron run before rescheduling. */
const PRUNE_BATCH = 100;

/**
 * Bounded rate-limit key space. The route passes a proxy-derived peer address,
 * so hashing it into this many buckets keeps a flood of spoofed addresses from
 * growing `rateLimits` without bound while still separating ordinary clients.
 */
const NATIVE_AUTH_RATE_BUCKET_COUNT = 4096;

function handoffContext(codeHash: string): { scope: string; recordId: string } {
  return { scope: "native-auth-handoff", recordId: codeHash };
}

async function transactionHash(tx: string): Promise<string> {
  return await sha256Hex(`native-auth-transaction:${tx}`);
}

/**
 * Records the browser transaction that a `native/start` navigation opened.
 *
 * The row is keyed by the client-generated transaction id and bound to the same
 * browser by an HttpOnly cookie. A `finish` without that cookie therefore has no
 * row it can consume, even though a cross-site top-level navigation still sends
 * the ambient session cookie.
 */
export const createTransaction = internalMutation({
  args: {
    tx: v.string(),
    challenge: v.string(),
    returnTarget: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const txHash = await transactionHash(args.tx);
    const now = Date.now();
    const existing = await ctx.db
      .query("nativeAuthTransactions")
      .withIndex("by_tx_hash", (q) => q.eq("txHash", txHash))
      .unique();
    const fields = {
      challenge: args.challenge,
      returnTarget: args.returnTarget,
      createdAt: now,
      expiresAt: now + NATIVE_AUTH_TX_TTL_MS,
    };
    if (existing === null) {
      await ctx.db.insert("nativeAuthTransactions", { txHash, ...fields });
    } else if (
      existing.challenge === args.challenge &&
      existing.returnTarget === args.returnTarget
    ) {
      // A reloaded start URL reuses its transaction id; refresh instead of
      // accumulating rows for one browser flow.
      await ctx.db.patch(existing._id, fields);
    }
    // A different challenge or return for an already-known transaction id is
    // not a reload. Keep the first row so a leaked id cannot replace the flow
    // another browser is waiting to finish.
    return null;
  },
});

/**
 * Charges one finish attempt against the live transaction the request names.
 *
 * The counter lives on `nativeAuthTransactions` itself, so it is isolated by the
 * actual transaction id. Hashing transaction ids into the shared `rateLimits`
 * buckets let a caller who precomputed ids covering every bucket spend a
 * victim's allowance without knowing the victim's transaction. Here a charge is
 * only possible when this exact transaction row exists and has not expired; a
 * missing or expired id charges nothing at all and stays behind the route's
 * anonymous per-address/global limits.
 */
export const chargeTransactionFinish = internalMutation({
  args: { tx: v.string() },
  returns: v.union(
    v.object({ status: v.literal("allowed") }),
    v.object({ status: v.literal("rate_limited"), retryAfterMs: v.number() }),
    v.object({ status: v.literal("missing") }),
    v.object({ status: v.literal("expired") }),
  ),
  handler: async (ctx, args) => {
    const now = Date.now();
    const txHash = await transactionHash(args.tx);
    const transaction = await ctx.db
      .query("nativeAuthTransactions")
      .withIndex("by_tx_hash", (q) => q.eq("txHash", txHash))
      .unique();
    if (transaction === null) {
      return { status: "missing" as const };
    }
    if (transaction.expiresAt <= now) {
      return { status: "expired" as const };
    }
    const windowStart = transaction.finishWindowStart;
    if (windowStart === undefined || now - windowStart >= NATIVE_AUTH_RATE_WINDOW_MS) {
      await ctx.db.patch(transaction._id, { finishWindowStart: now, finishAttempts: 1 });
      return { status: "allowed" as const };
    }
    const next = (transaction.finishAttempts ?? 0) + 1;
    const retryAfterMs = Math.max(0, windowStart + NATIVE_AUTH_RATE_WINDOW_MS - now);
    // Keep counting past the limit so a flood does not reset the window early.
    await ctx.db.patch(transaction._id, { finishAttempts: next });
    if (next > NATIVE_AUTH_FINISH_PER_TX) {
      return { status: "rate_limited" as const, retryAfterMs };
    }
    return { status: "allowed" as const };
  },
});

/**
 * Atomically consumes a start transaction after checking its challenge and
 * return target. Returns `false` for a missing, expired or mismatched row, and
 * leaves a mismatched row in place so a stray finish URL cannot burn the real
 * flow. The mint below performs the same check and deletion in one mutation.
 */
export const consumeTransaction = internalMutation({
  args: {
    tx: v.string(),
    challenge: v.string(),
    returnTarget: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const txHash = await transactionHash(args.tx);
    const row = await ctx.db
      .query("nativeAuthTransactions")
      .withIndex("by_tx_hash", (q) => q.eq("txHash", txHash))
      .unique();
    if (row === null) {
      return false;
    }
    if (row.expiresAt <= Date.now()) {
      await ctx.db.delete(row._id);
      return false;
    }
    if (
      !constantTimeEqual(row.challenge, args.challenge) ||
      row.returnTarget !== args.returnTarget
    ) {
      return false;
    }
    await ctx.db.delete(row._id);
    return true;
  },
});

/**
 * Mints one code for a finished session. Returns the plaintext exactly once;
 * only its digest and the sealed token reach the database.
 *
 * The start transaction is deleted in the same mutation that inserts the code,
 * so a finish is single-use even under two concurrent requests: the loser's
 * optimistic retry finds no transaction and mints nothing. Failures are returned
 * as a status rather than thrown so the route can tell an expired transaction
 * (`auth_expired`) from a missing or mismatched one.
 */
export const create = internalMutation({
  args: {
    token: v.string(),
    challenge: v.string(),
    server: v.string(),
    tx: v.string(),
    returnTarget: v.string(),
  },
  returns: v.union(
    v.object({ status: v.literal("ok"), code: v.string() }),
    v.object({ status: v.literal("missing") }),
    v.object({ status: v.literal("expired") }),
    v.object({ status: v.literal("mismatch") }),
  ),
  handler: async (ctx, args) => {
    const now = Date.now();
    const txHash = await transactionHash(args.tx);
    const transaction = await ctx.db
      .query("nativeAuthTransactions")
      .withIndex("by_tx_hash", (q) => q.eq("txHash", txHash))
      .unique();
    if (transaction === null) {
      return { status: "missing" as const };
    }
    if (transaction.expiresAt <= now) {
      await ctx.db.delete(transaction._id);
      return { status: "expired" as const };
    }
    if (
      !constantTimeEqual(transaction.challenge, args.challenge) ||
      transaction.returnTarget !== args.returnTarget
    ) {
      return { status: "mismatch" as const };
    }
    await ctx.db.delete(transaction._id);

    const code = randomToken(CODE_BYTES);
    const codeHash = await sha256Hex(code);
    await ctx.db.insert("nativeAuthHandoffs", {
      codeHash,
      challenge: args.challenge,
      sessionCiphertext: await sealString(handoffContext(codeHash), args.token),
      server: args.server,
      createdAt: now,
      expiresAt: now + HANDOFF_CODE_TTL_MS,
    });
    return { status: "ok" as const, code };
  },
});

/**
 * Cheap, read-only pre-check for the exchange route: does this request present
 * a code and verifier that could still be redeemed? It never consumes, so the
 * `consume` mutation below stays authoritative. The route uses the answer only
 * to decide whether the caller proved possession of a code and may skip the
 * shared anonymous ceiling.
 */
export const peek = internalQuery({
  args: {
    code: v.string(),
    verifier: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    if (args.code.length === 0 || args.verifier.length === 0 || args.verifier.length > 256) {
      return false;
    }
    const codeHash = await sha256Hex(args.code);
    const row = await ctx.db
      .query("nativeAuthHandoffs")
      .withIndex("by_code_hash", (q) => q.eq("codeHash", codeHash))
      .unique();
    if (row === null || row.expiresAt <= Date.now()) {
      return false;
    }
    return constantTimeEqual(row.challenge, await sha256Hex(args.verifier));
  },
});

/**
 * Atomically consumes a code. Returns the sealed session only when the code is
 * unexpired, unused and paired with the verifier that hashes to its challenge.
 * Every failure returns `null`, which the route reports as the same generic
 * error, so a caller cannot distinguish unknown, expired or already-used codes.
 */
export const consume = internalMutation({
  args: {
    code: v.string(),
    verifier: v.string(),
  },
  handler: async (ctx, args): Promise<{ token: string; server: string } | null> => {
    if (args.code.length === 0 || args.verifier.length === 0 || args.verifier.length > 256) {
      return null;
    }
    const codeHash = await sha256Hex(args.code);
    const row = await ctx.db
      .query("nativeAuthHandoffs")
      .withIndex("by_code_hash", (q) => q.eq("codeHash", codeHash))
      .unique();
    if (row === null) {
      return null;
    }
    if (row.expiresAt <= Date.now()) {
      await ctx.db.delete(row._id);
      return null;
    }
    // A wrong verifier leaves the row in place: it cannot be used without the
    // right verifier, and deleting it would let a stranger burn a pending
    // sign-in by guessing.
    if (!constantTimeEqual(row.challenge, await sha256Hex(args.verifier))) {
      return null;
    }
    await ctx.db.delete(row._id);
    try {
      return {
        token: await openString(handoffContext(codeHash), row.sessionCiphertext),
        server: row.server,
      };
    } catch {
      return null;
    }
  },
});

/**
 * Fixed-window limiter shared by the native auth HTTP routes. The route layer
 * cannot write directly and must not throw a rate-limit error before a response
 * is selected, so this returns the decision instead.
 *
 * The subject is hashed into a bounded bucket set. Callers pass a proxy-derived
 * peer address (or a session id), both of which are either attacker-supplied or
 * long enough that storing them verbatim would let a flood grow `rateLimits`
 * without bound for the seven-day retention window.
 */
export const consumeNativeAuthRateLimit = internalMutation({
  args: {
    action: v.string(),
    subject: v.string(),
    limit: v.number(),
    windowMs: v.number(),
    /**
     * Optional ceiling shared by every caller of this action. Unauthenticated
     * routes set it so a distributed flood cannot keep creating buckets.
     */
    globalLimit: v.optional(v.number()),
    /**
     * Set when the request proved possession of a start transaction or a
     * redeemable code. Such a caller skips the shared bucket: the ceiling is an
     * emergency bound on anonymous work, not a limit on a real sign-in.
     */
    verified: v.optional(v.boolean()),
  },
  returns: v.object({ allowed: v.boolean(), retryAfterMs: v.number() }),
  handler: async (ctx, args) => {
    const fingerprint = await sha256Hex(`native-auth:${args.action}:${args.subject}`);
    const bucket = Number.parseInt(fingerprint.slice(0, 8), 16) % NATIVE_AUTH_RATE_BUCKET_COUNT;
    const perSubject = await consumeRateLimit(ctx, {
      key: `native-auth:${args.action}:${bucket}`,
      limit: args.limit,
      windowMs: args.windowMs,
    });
    // A refused subject must not spend the shared budget: otherwise one
    // already-limited caller can exhaust the ceiling for everyone else.
    if (!perSubject.allowed || args.globalLimit === undefined || args.verified === true) {
      return perSubject;
    }
    const global = await consumeRateLimit(ctx, {
      key: `native-auth:${args.action}:global`,
      limit: args.globalLimit,
      windowMs: args.windowMs,
    });
    return {
      allowed: global.allowed,
      retryAfterMs: Math.max(perSubject.retryAfterMs, global.retryAfterMs),
    };
  },
});

/**
 * Spends one hit of an action's shared anonymous ceiling without touching any
 * per-subject bucket. The exchange route charges its per-subject allowance
 * first and only asks about the shared bucket after `peek` says the request did
 * not prove a redeemable code.
 */
export const consumeNativeAuthGlobalLimit = internalMutation({
  args: {
    action: v.string(),
    limit: v.number(),
    windowMs: v.number(),
  },
  returns: v.object({ allowed: v.boolean(), retryAfterMs: v.number() }),
  handler: async (ctx, args) => {
    return await consumeRateLimit(ctx, {
      key: `native-auth:${args.action}:global`,
      limit: args.limit,
      windowMs: args.windowMs,
    });
  },
});

/**
 * Cron hook: drops expired rows through `by_expires`, never scanning the
 * table, and drains a backlog by rescheduling while a batch is full.
 */
export const pruneExpired = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const rows = await ctx.db
      .query("nativeAuthHandoffs")
      .withIndex("by_expires", (q) => q.lt("expiresAt", Date.now()))
      .take(PRUNE_BATCH);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    if (rows.length === PRUNE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.nativeAuthHandoff.pruneExpired, {});
    }
    return rows.length;
  },
});

/** Cron hook: drops expired start transactions in bounded batches. */
export const pruneExpiredTransactions = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const rows = await ctx.db
      .query("nativeAuthTransactions")
      .withIndex("by_expires", (q) => q.lt("expiresAt", Date.now()))
      .take(PRUNE_BATCH);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    if (rows.length === PRUNE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.nativeAuthHandoff.pruneExpiredTransactions, {});
    }
    return rows.length;
  },
});
