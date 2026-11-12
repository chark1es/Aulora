import { type MemberView, memberDisplayName, type RoleView, roleColorFor } from "@aulora/core";

/**
 * Pure view helpers for the mobile admin surfaces. The shared role, member and
 * permission helpers live in `@aulora/core`; this module adds only the
 * channel-edit planning the mobile sheets use. Nothing here talks to the
 * server: it reshapes data already returned by Convex and resolves the same
 * bitfield the server enforces. The server remains the source of truth.
 */

export {
  canManageChannels,
  heldRoleIds,
  type MemberView,
  memberDisplayName,
  type OverrideView,
  type ResolveViewerInput,
  type RoleView,
  resolveViewerPermissions,
  roleColorFor,
  roleRef,
  toCoreRoles,
} from "@aulora/core";

/** A member flattened for the channel-edit picker. */
export interface MobileMemberEntry {
  readonly userId: string;
  readonly displayName: string;
  readonly roleIds: readonly string[];
  readonly isOwner: boolean;
  readonly roleColor: string | null;
}

/** Flattens a member view for the channel-edit picker. */
export function memberViewToEntry(
  member: MemberView,
  roles: readonly RoleView[],
  ownerIds: readonly string[],
  fallback: string,
): MobileMemberEntry {
  return {
    userId: member.userId,
    displayName: memberDisplayName(member, fallback),
    roleIds: member.roleIds,
    isOwner: ownerIds.includes(member.userId),
    roleColor: roleColorFor(member, roles),
  };
}

/** Whether two id lists hold the same distinct values, order-insensitive. */
export function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export interface ChannelEditPatch {
  readonly name: string;
  readonly topic: string;
  readonly private: boolean;
  readonly memberIds: readonly string[];
  readonly blockedUserIds: readonly string[];
}

export interface ChannelEditOriginal {
  readonly name: string;
  readonly topic: string;
  readonly private: boolean;
  readonly memberIds: readonly string[];
  readonly blockedUserIds: readonly string[];
}

/** Only the fields that actually changed; `null` means "leave untouched". */
export interface ChannelEditPlan {
  readonly name: string | null;
  readonly topic: string | null;
  readonly privacy: { readonly private: boolean; readonly memberIds: readonly string[] } | null;
  readonly blockedUserIds: readonly string[] | null;
}

/**
 * Diffs a channel-edit submission against the channel's current values, mirroring
 * the web `commitChannelEdit`: only changed fields are applied, membership is
 * only rewritten when the privacy or member set changed, and set comparisons are
 * order-insensitive.
 */
export function planChannelEdit(
  original: ChannelEditOriginal,
  next: ChannelEditPatch,
  ownUserId: string,
): ChannelEditPlan {
  const trimmedName = next.name.trim();
  const name = trimmedName.length > 0 && trimmedName !== original.name ? trimmedName : null;
  const topic = next.topic !== original.topic ? next.topic : null;
  const membership = next.private ? [...new Set([ownUserId, ...next.memberIds])] : [];
  const membershipChanged =
    next.private !== original.private ||
    (next.private && !sameStringSet(next.memberIds, original.memberIds));
  const blockedUserIds = sameStringSet(next.blockedUserIds, original.blockedUserIds)
    ? null
    : [...new Set(next.blockedUserIds)];
  return {
    name,
    topic,
    privacy: membershipChanged ? { private: next.private, memberIds: membership } : null,
    blockedUserIds,
  };
}
