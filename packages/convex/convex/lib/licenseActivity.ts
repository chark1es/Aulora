import { isBotUserId } from "@aulora/core";
import type { MutationCtx } from "../_generated/server";
import { isLicenseKey } from "./license";

export function utcMonth(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

export interface LicenseActivityOptions {
  /**
   * When set, the caller already resolved this user's membership (e.g. via
   * `requireMember`), so the member row is not read a second time. `false`
   * means the user has no member row (the workspace owner) and is not counted.
   */
  readonly isMember?: boolean;
}

/** Counts a real authenticated member once per licensed UTC month. */
export async function recordLicenseActivity(
  ctx: MutationCtx,
  userId: string,
  now = Date.now(),
  options: LicenseActivityOptions = {},
) {
  // Bots are never a seat: they must not count toward monthly active users.
  if (isBotUserId(userId)) {
    return;
  }
  const server = await ctx.db.query("server").first();
  const proof = server?.licenseValidation;
  // No active licence: return before any member or usage lookup.
  if (
    !server ||
    !proof?.licenseId ||
    proof.billingModel !== "monthly-active-users" ||
    proof.state !== "active" ||
    !proof.expiresAt ||
    proof.expiresAt <= now ||
    !server.licenseKey ||
    !isLicenseKey(server.licenseKey)
  )
    return;
  if (options.isMember === false) return;
  if (
    options.isMember === undefined &&
    !(await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique())
  )
    return;
  const month = utcMonth(now);
  const licenseId = proof.licenseId;
  const existing = await ctx.db
    .query("licenseActivity")
    .withIndex("by_license_month_user", (q) =>
      q.eq("licenseId", licenseId).eq("month", month).eq("userId", userId),
    )
    .unique();
  if (existing) return;
  await ctx.db.insert("licenseActivity", { licenseId, month, userId });
  const aggregate = await ctx.db
    .query("licenseUsageMonths")
    .withIndex("by_license_month", (q) => q.eq("licenseId", licenseId).eq("month", month))
    .unique();
  if (aggregate) await ctx.db.patch(aggregate._id, { activeUsers: aggregate.activeUsers + 1 });
  else
    await ctx.db.insert("licenseUsageMonths", {
      licenseId,
      month,
      activeUsers: 1,
    });
}
