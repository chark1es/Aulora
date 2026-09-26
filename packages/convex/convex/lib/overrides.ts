import { ConvexError, v } from "convex/values";
import { assertValidPermissionBits } from "./permissions";

/** Stored shape for a channel or category permission override. */
export const overwriteValidator = v.object({
  targetId: v.string(),
  targetType: v.union(v.literal("role"), v.literal("member")),
  allow: v.int64(),
  deny: v.int64(),
});

export interface OverwriteInput {
  readonly targetId: string;
  readonly targetType: "role" | "member";
  readonly allow: bigint;
  readonly deny: bigint;
}

/**
 * Rejects permission bits that are not defined flags, and rejects an override
 * that both allows and denies the same flag.
 */
export function validateOverrides(overrides: readonly OverwriteInput[]): void {
  for (const override of overrides) {
    assertValidPermissionBits(override.allow);
    assertValidPermissionBits(override.deny);
    if ((override.allow & override.deny) !== 0n) {
      throw new ConvexError("An override cannot allow and deny the same flag");
    }
  }
}
