import {
  EVERYONE_ROLE_ID,
  hasPermission,
  type Overwrite,
  Permission,
  type Role,
  resolvePermissions,
} from "./permissions";
import { roleRef } from "./role-color";

/**
 * Framework-agnostic view helpers for the admin surfaces, shared by web and
 * mobile.
 *
 * These reshape role/member/override data returned by the server and resolve
 * the same bitfield the server enforces, so the UI hides what the actor cannot
 * do. The server remains the source of truth. Nothing here talks to the server
 * and nothing here touches the DOM or React Native.
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
  /** This workspace's profile picture. Missing on older payloads. */
  readonly avatarUrl?: string | null;
  /** True for a bot member. Missing on older servers. */
  readonly isBot?: boolean;
}

export type OverrideView = Overwrite;

/** Maps stored role views onto the framework-agnostic permission shape. */
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
