import type { Overwrite } from "@aulora/core";
import {
  canManageRole,
  canModerateMember,
  EVERYONE_ROLE_ID,
  PERMISSION_NAMES,
  Permission,
  type PermissionName,
  type Role,
  resolvePermissions,
} from "@aulora/core";

/**
 * Pure view helpers for the Phase 3 admin surfaces. Nothing here talks to the
 * server or holds secrets: it only reshapes role/member/override data already
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

export interface CategoryView {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  readonly overrides: readonly OverrideView[];
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

/** Highest-position role a member holds, or `null` when only `@everyone`. */
export function topRole(member: MemberView | null, roles: readonly RoleView[]): RoleView | null {
  if (member === null) {
    return null;
  }
  const held = new Set(member.roleIds);
  let best: RoleView | null = null;
  for (const role of roles) {
    if (!held.has(roleRef(role))) {
      continue;
    }
    if (best === null || role.position > best.position) {
      best = role;
    }
  }
  return best;
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

/**
 * The names of the roles a member holds, highest position first, skipping
 * `@everyone` (which every member has and which adds no signal).
 */
export function roleNamesFor(member: MemberView | null, roles: readonly RoleView[]): string[] {
  if (member === null) {
    return [];
  }
  const held = new Set(member.roleIds);
  return roles
    .filter((role) => !role.isEveryone && held.has(roleRef(role)))
    .sort((a, b) => b.position - a.position)
    .map((role) => role.name);
}

/** Display name honoring a nickname override, falling back to the base name. */
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

/** Whether the viewer may edit/assign/delete `role`. UI copy of the server. */
export function canManageRoleUi(
  viewer: { isOwner: boolean; topPosition: number },
  role: RoleView,
): boolean {
  if (role.isEveryone) {
    return false;
  }
  return canManageRole(
    {
      userId: "viewer",
      topRolePosition: viewer.topPosition,
      isOwner: viewer.isOwner,
    },
    role.position,
  );
}

/** Whether the viewer may moderate `target`. UI copy of the server. */
export function canModerateUi(input: {
  readonly viewer: { userId: string; isOwner: boolean; roleIds: readonly string[] };
  readonly target: { userId: string; isOwner: boolean; roleIds: readonly string[] };
  readonly roles: readonly RoleView[];
}): boolean {
  return canModerateMember({
    actor: {
      userId: input.viewer.userId,
      roleIds: input.viewer.roleIds,
      isOwner: input.viewer.isOwner,
    },
    target: {
      userId: input.target.userId,
      roleIds: input.target.roleIds,
      isOwner: input.target.isOwner,
    },
    roles: toCoreRoles(input.roles),
  });
}

/** Position of the highest role in a set of role refs. */
export function topPositionForRefs(refs: readonly string[], roles: readonly RoleView[]): number {
  const held = new Set(refs);
  let top = -1;
  for (const role of roles) {
    if (held.has(roleRef(role)) || role.isEveryone) {
      top = Math.max(top, role.position);
    }
  }
  return top;
}

export interface PermissionGroup {
  readonly label: string;
  readonly permissions: readonly PermissionName[];
}

/** Permission flags grouped for the role editor, in the plan.md order. */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    label: "General",
    permissions: [
      "ViewChannel",
      "ManageChannels",
      "ManageRoles",
      "ManageWorkspace",
      "ViewAuditLog",
      "CreateInvites",
      "ManageEmoji",
    ],
  },
  {
    label: "Members",
    permissions: ["Kick", "Ban", "Timeout", "ChangeOwnNickname", "ManageNicknames"],
  },
  {
    label: "Messages",
    permissions: [
      "SendMessages",
      "SendInThreads",
      "CreateThreads",
      "AttachFiles",
      "EmbedLinks",
      "AddReactions",
      "MentionEveryone",
      "ManageMessages",
      "PinMessages",
      "ReadHistory",
    ],
  },
  { label: "Special", permissions: ["Administrator"] },
];

/** Human labels for each flag, used by the toggles and override grid. */
export const PERMISSION_LABELS: Record<PermissionName, string> = {
  ViewChannel: "View channels",
  ManageChannels: "Manage channels",
  ManageRoles: "Manage roles",
  ManageWorkspace: "Manage workspace",
  ViewAuditLog: "View audit log",
  CreateInvites: "Create invites",
  ManageEmoji: "Manage emoji",
  Kick: "Kick members",
  Ban: "Ban members",
  Timeout: "Timeout members",
  ChangeOwnNickname: "Change own nickname",
  ManageNicknames: "Manage nicknames",
  SendMessages: "Send messages",
  SendInThreads: "Send in threads",
  CreateThreads: "Create threads",
  AttachFiles: "Attach files",
  EmbedLinks: "Embed links",
  AddReactions: "Add reactions",
  MentionEveryone: "Mention everyone",
  ManageMessages: "Manage messages",
  PinMessages: "Pin messages",
  ReadHistory: "Read history",
  Administrator: "Administrator",
};

/** Sets or clears a single flag in a bitfield. */
export function togglePermissionBit(
  current: bigint,
  name: PermissionName,
  enabled: boolean,
): bigint {
  return enabled ? current | Permission[name] : current & ~Permission[name];
}

/** Every defined flag, for select-all/clear-all controls. */
export const ALL_PERMISSION_NAMES: readonly PermissionName[] = PERMISSION_NAMES;

export type OverrideLevel = "inherit" | "allow" | "deny";

/** The current level for one target + flag in an override set. */
export function overrideLevel(
  overrides: readonly OverrideView[],
  target: { targetId: string; targetType: "role" | "member" },
  name: PermissionName,
): OverrideLevel {
  const match = overrides.find(
    (override) =>
      override.targetId === target.targetId && override.targetType === target.targetType,
  );
  if (match === undefined) {
    return "inherit";
  }
  const flag = Permission[name];
  if ((match.allow & flag) !== 0n) {
    return "allow";
  }
  if ((match.deny & flag) !== 0n) {
    return "deny";
  }
  return "inherit";
}

function upsertOverride(
  overrides: readonly OverrideView[],
  target: { targetId: string; targetType: "role" | "member" },
  mutate: (current: { allow: bigint; deny: bigint }) => { allow: bigint; deny: bigint } | null,
): OverrideView[] {
  const index = overrides.findIndex(
    (override) =>
      override.targetId === target.targetId && override.targetType === target.targetType,
  );
  const current = index >= 0 ? overrides[index] : undefined;
  const next = mutate({ allow: current?.allow ?? 0n, deny: current?.deny ?? 0n });
  const result = overrides.filter((_, i) => i !== index);
  if (next !== null && (next.allow !== 0n || next.deny !== 0n)) {
    result.push({
      targetId: target.targetId,
      targetType: target.targetType,
      allow: next.allow,
      deny: next.deny,
    });
  }
  return result;
}

/**
 * Applies an override level for one flag, keeping `allow`/`deny` disjoint. The
 * server rejects a flag that is both allowed and denied, so each transition
 * clears the opposite bit.
 */
export function setOverrideLevel(
  overrides: readonly OverrideView[],
  target: { targetId: string; targetType: "role" | "member" },
  name: PermissionName,
  level: OverrideLevel,
): OverrideView[] {
  const flag = Permission[name];
  return upsertOverride(overrides, target, (current) => {
    const allow = current.allow & ~flag;
    const deny = current.deny & ~flag;
    if (level === "allow") {
      return { allow: allow | flag, deny };
    }
    if (level === "deny") {
      return { allow, deny: deny | flag };
    }
    return { allow, deny };
  });
}

export type OverrideTargetType = "role" | "member";

export interface OverrideTarget {
  readonly targetId: string;
  readonly targetType: OverrideTargetType;
  readonly label: string;
  readonly color?: string | null;
}
