import { allowlistAdmits } from "@aulora/core";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { parseEmailConfig } from "./email";

type ReadCtx = QueryCtx | MutationCtx;

/** Whether mail can be sent: a saved transport, else the deployment environment. */
export async function emailTransportConfigured(ctx: ReadCtx): Promise<boolean> {
  const saved = await ctx.db.query("emailSettings").first();
  return (saved?.provider ?? parseEmailConfig().provider) !== "none";
}

/** Whether `email` is covered by an allowlist entry. */
export async function emailIsAllowlisted(
  ctx: ReadCtx,
  email: string | null | undefined,
): Promise<boolean> {
  if (email === null || email === undefined) {
    return false;
  }
  const entries = await ctx.db.query("inviteAllowlist").collect();
  return allowlistAdmits(
    entries.map((entry) => entry.pattern),
    email,
  );
}
