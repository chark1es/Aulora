import {
  EVERYONE_ROLE_ID,
  hasPermission,
  type Overwrite,
  Permission,
  type Role,
  resolvePermissions,
} from "@aulora/core";

/**
 * Pure view helpers for the mobile admin surfaces, mirroring
 * `apps/web/src/lib/workspace-admin.ts` without importing it. Nothing here
 * talks to the server: it only reshapes role/member/override data already
 * returned by Convex and resolves the same bitfield the server enforces, so the
 * UI hides what the actor cannot do. The server remains the source of truth.
 */

export interface RoleView {
  readonly id: string;
  readonly key: string | null;
  readonly name: string;
  readonly color: string | null;
  readonly position: number;
  readonly permissions: bigint;
  readonly hoisted: boolean;
  readonly mentionable: boolean;
  readonly isEveryone: boolean;
}

export interface MemberView {
  readonly id: string;
  readonly userId: string;
  readonly nickname: string | null;
  /** The account's own name from the server (absent on older servers). */
  readonly accountName?: string | null;
  readonly roleIds: readonly string[];
  readonly joinedAt: number;
  readonly timeoutUntil: number | null;
}

export type OverrideView = Overwrite;

/** A member flattened for the channel-edit picker. */
export interface MobileMemberEntry {
  readonly userId: string;
  readonly displayName: string;
  readonly roleIds: readonly string[];
  readonly isOwner: boolean;
  readonly roleColor: string | null;
}

/** Stable reference a member stores for a role (`key` wins over `_id`). */
export function roleRef(role: { readonly id: string; readonly key: string | null }): string {
  return role.key ?? role.id;
}

/** Maps stored role views onto the framework-agnostic `@aulora/core` shape. */
export function toCoreRoles(roles: readonly RoleView[]): Role[] {
  return roles.map((role) => ({
    id: roleRef(role),
    position: role.position,
    permissions: role.permissions,
    isEveryone: role.isEveryone,
  }));
}

/** The role ids a member holds, always including `@everyone`. */
export function heldRoleIds(member: MemberView | null, roles: readonly RoleView[]): string[] {
  const ids = new Set<string>(member?.roleIds ?? []);
  for (const role of roles) {
    if (role.isEveryone) {
      ids.add(roleRef(role));
    }
  }
  if (ids.size === 0) {
    ids.add(EVERYONE_ROLE_ID);
  }
  return [...ids];
}

export interface ResolveViewerInput {
  readonly viewer: { readonly userId: string; readonly isOwner: boolean };
  readonly member: MemberView | null;
  readonly roles: readonly RoleView[];
  readonly categoryOverrides?: readonly OverrideView[];
  readonly channelOverrides?: readonly OverrideView[];
}

/** Resolves the actor's effective permissions exactly as the server does. */
export function resolveViewerPermissions(input: ResolveViewerInput): bigint {
  return resolvePermissions({
    actor: {
      userId: input.viewer.userId,
      roleIds: heldRoleIds(input.member, input.roles),
      isOwner: input.viewer.isOwner,
    },
    roles: toCoreRoles(input.roles),
    ...(input.categoryOverrides !== undefined
      ? { categoryOverrides: input.categoryOverrides }
      : {}),
    ...(input.channelOverrides !== undefined ? { channelOverrides: input.channelOverrides } : {}),
  });
}

/** Whether the viewer may manage channels: owner, or the `ManageChannels` bit. */
export function canManageChannels(isOwner: boolean, permissions: bigint): boolean {
  return isOwner || hasPermission(permissions, Permission.ManageChannels);
}

/** Nickname first, then the account's own name, then `fallback`. */
export function memberDisplayName(member: MemberView | null, fallback: string): string {
  const nickname = member?.nickname;
  if (nickname !== undefined && nickname !== null && nickname.length > 0) {
    return nickname;
  }
  const accountName = member?.accountName;
  return accountName !== undefined && accountName !== null && accountName.length > 0
    ? accountName
    : fallback;
}

/**
 * The color that tints a member's avatar ring and username: the color of their
 * highest-position colored role.
 */
export function roleColorFor(member: MemberView | null, roles: readonly RoleView[]): string | null {
  if (member === null) {
    return null;
  }
  const held = new Set(member.roleIds);
  let best: RoleView | null = null;
  for (const role of roles) {
    if (role.color === null || role.color.length === 0 || !held.has(roleRef(role))) {
      continue;
    }
    if (best === null || role.position > best.position) {
      best = role;
    }
  }
  return best?.color ?? null;
}

/** Flattens a member view for the channel-edit picker. */
export function memberViewToEntry(
  member: MemberView,
  roles: readonly RoleView[],
  ownerId: string | null,
  fallback: string,
): MobileMemberEntry {
  return {
    userId: member.userId,
    displayName: memberDisplayName(member, fallback),
    roleIds: member.roleIds,
    isOwner: member.userId === ownerId,
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
 * the web `submitChannelEdit`: only changed fields are applied, membership is
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
