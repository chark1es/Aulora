import { ConvexError } from "convex/values";
import type { ActionCtx, MutationCtx } from "../_generated/server";

/**
 * Reusable fixed-window rate limiting, backed by the `rateLimits` table.
 *
 * Keys are namespaced by action and actor, e.g. `send:user:<id>` or
 * `upload:ip:<addr>`. Counters are never exposed to clients.
 */
export interface RateLimitOptions {
  /** Namespaced counter key. Use {@link userRateLimitKey} / {@link ipRateLimitKey}. */
  readonly key: string;
  /** Maximum allowed hits per window. */
  readonly limit: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
  /** Injectable clock (tests); defaults to `Date.now()`. */
  readonly now?: number;
}

export function userRateLimitKey(action: string, userId: string): string {
  return `${action}:user:${userId}`;
}

export function ipRateLimitKey(action: string, ip: string): string {
  return `${action}:ip:${ip}`;
}

/**
 * Reads the caller's IP from request metadata (null for CLI/cron callers, in
 * which case `"unknown"` is used so a shared bucket still applies). Only
 * mutations and actions are triggered by an HTTP request, so queries are
 * excluded.
 */
export async function requestIp(ctx: MutationCtx | ActionCtx): Promise<string> {
  const metadata = await ctx.meta.getRequestMetadata();
  return metadata.ip ?? "unknown";
}

export interface RateLimitResult {
  readonly allowed: boolean;
  /** Milliseconds until the current fixed window resets. */
  readonly retryAfterMs: number;
}

/**
 * Counts one hit and reports whether it is allowed without throwing. The write
 * therefore commits even on refusal, which callers such as the setup-claim gate
 * need: a thrown mutation would roll the counter (and its audit row) back.
 */
export async function consumeRateLimit(
  ctx: MutationCtx,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const now = options.now ?? Date.now();
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", options.key))
    .unique();

  if (existing === null) {
    await ctx.db.insert("rateLimits", { key: options.key, windowStart: now, count: 1 });
    return { allowed: true, retryAfterMs: options.windowMs };
  }

  if (now - existing.windowStart >= options.windowMs) {
    await ctx.db.patch(existing._id, { windowStart: now, count: 1 });
    return { allowed: true, retryAfterMs: options.windowMs };
  }

  const next = existing.count + 1;
  const retryAfterMs = Math.max(0, existing.windowStart + options.windowMs - now);
  // Keep counting past the limit so a flood does not reset the window early.
  await ctx.db.patch(existing._id, { count: next });
  return { allowed: next <= options.limit, retryAfterMs };
}

/**
 * Counts one hit against `options.key` and throws once the window limit is
 * exceeded. Throws {@link ConvexError} so the failure crosses the wire as a
 * domain error rather than an internal one.
 */
export async function enforceRateLimit(ctx: MutationCtx, options: RateLimitOptions): Promise<void> {
  const result = await consumeRateLimit(ctx, options);
  if (!result.allowed) {
    throw new ConvexError("Rate limit exceeded");
  }
}
