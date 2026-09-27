import type { GenericCtx } from "@convex-dev/better-auth";
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
 * Resolves account display names from the Better Auth component. A lookup
 * that fails (for example when the component is not mounted) yields `null`
 * rather than failing the whole member list.
 */
export async function accountNames(
  ctx: GenericCtx<DataModel>,
  userIds: readonly string[],
): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  for (const userId of new Set(userIds)) {
    try {
      names.set(userId, accountDisplayName(await authComponent.getAnyUserById(ctx, userId)));
    } catch {
      names.set(userId, null);
    }
  }
  return names;
}
