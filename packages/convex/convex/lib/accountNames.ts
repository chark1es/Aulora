import { isBotUserId } from "@aulora/core";
import type { GenericCtx } from "@convex-dev/better-auth";
import { isMutationCtx, isQueryCtx } from "@convex-dev/better-auth/utils";
import type { DataModel } from "../_generated/dataModel";
import { authComponent } from "../auth";

/**
 * The name to show for an account: its profile name, else the local part of
 * its email. `null` when neither is usable, so callers fall back explicitly.
 */
export function accountDisplayName(
  user: { readonly name?: string | null; readonly email?: string | null } | null | undefined,
): string | null {
  const name = user?.name?.trim();
  if (name !== undefined && name.length > 0) {
    return name;
  }
  const local = user?.email?.split("@")[0]?.trim();
  return local !== undefined && local.length > 0 ? local : null;
}

/**
 * The display name of a bot, read from the `bots` table. A bot id must never
 * reach the Better Auth component. `null` when the row is gone or unreadable.
 */
async function botName(ctx: GenericCtx<DataModel>, userId: string): Promise<string | null> {
  if (!isQueryCtx(ctx) && !isMutationCtx(ctx)) {
    return null;
  }
  try {
    const bot = await ctx.db
      .query("bots")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const name = bot?.name.trim();
    return name !== undefined && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/**
 * Resolves account display names from the Better Auth component. A lookup
 * that fails (for example when the component is not mounted) yields `null`
 * rather than failing the whole member list. Bot ids resolve from the `bots`
 * table instead and are never sent to the auth component.
 */
export async function accountNames(
  ctx: GenericCtx<DataModel>,
  userIds: readonly string[],
): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  for (const userId of new Set(userIds)) {
    if (isBotUserId(userId)) {
      names.set(userId, await botName(ctx, userId));
      continue;
    }
    try {
      names.set(userId, accountDisplayName(await authComponent.getAnyUserById(ctx, userId)));
    } catch {
      names.set(userId, null);
    }
  }
  return names;
}

export interface AccountIdentity {
  readonly email: string | null;
  readonly emailVerified: boolean;
}

/**
 * The sign-in email of an account and whether its provider vouched for it.
 * `null` when the account cannot be read, so callers fail closed.
 */
export async function accountIdentity(
  ctx: GenericCtx<DataModel>,
  userId: string,
): Promise<AccountIdentity | null> {
  try {
    const user = await authComponent.getAnyUserById(ctx, userId);
    if (user === null) {
      return null;
    }
    const email = user.email.trim();
    return { email: email.length > 0 ? email : null, emailVerified: user.emailVerified === true };
  } catch {
    return null;
  }
}
