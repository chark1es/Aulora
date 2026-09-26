/**
 * Discord-style permission bitfield.
 *
 * Bit positions follow the order documented in plan.md. All values are bigints
 * so the workspace can grow past 32 flags without a migration.
 */
export const Permission = {
  ViewChannel: 1n << 0n,
  ManageChannels: 1n << 1n,
  ManageRoles: 1n << 2n,
  ManageWorkspace: 1n << 3n,
  ViewAuditLog: 1n << 4n,
  CreateInvites: 1n << 5n,
  ManageEmoji: 1n << 6n,
  Kick: 1n << 7n,
  Ban: 1n << 8n,
  Timeout: 1n << 9n,
  ChangeOwnNickname: 1n << 10n,
  ManageNicknames: 1n << 11n,
  SendMessages: 1n << 12n,
  SendInThreads: 1n << 13n,
  CreateThreads: 1n << 14n,
  AttachFiles: 1n << 15n,
  EmbedLinks: 1n << 16n,
  AddReactions: 1n << 17n,
  MentionEveryone: 1n << 18n,
  ManageMessages: 1n << 19n,
  PinMessages: 1n << 20n,
  ReadHistory: 1n << 21n,
  Administrator: 1n << 22n,
} as const satisfies Record<string, bigint>;

export type PermissionName = keyof typeof Permission;
export type Permissions = bigint;

export const PERMISSION_NAMES = Object.keys(Permission) as PermissionName[];

export const ADMINISTRATOR: bigint = Permission.Administrator;

export const ALL_PERMISSIONS: bigint = Object.values(Permission).reduce<bigint>(
  (acc, flag) => acc | flag,
  0n,
);

/** Id used for the baseline role every member inherits. */
export const EVERYONE_ROLE_ID = "@everyone";

export function hasPermission(permissions: bigint, flag: bigint): boolean {
  if ((permissions & Permission.Administrator) !== 0n) {
    return true;
  }
  return (permissions & flag) === flag;
}

export function permissionNames(permissions: bigint): PermissionName[] {
  return PERMISSION_NAMES.filter((name) => (permissions & Permission[name]) !== 0n);
}

export function permissionsFromNames(names: readonly PermissionName[]): bigint {
  return names.reduce<bigint>((acc, name) => acc | Permission[name], 0n);
}

export interface Role {
  readonly id: string;
  readonly position: number;
  readonly permissions: bigint;
  /** Marks the workspace `@everyone` role. A role with id `@everyone` also counts. */
  readonly isEveryone?: boolean;
}

export interface Overwrite {
  readonly targetId: string;
  readonly targetType: "role" | "member";
  readonly allow: bigint;
  readonly deny: bigint;
}

export interface PermissionActor {
  readonly userId: string;
  readonly roleIds: readonly string[];
  readonly isOwner?: boolean;
}

export interface ResolvePermissionsInput {
  readonly actor: PermissionActor;
  readonly roles: readonly Role[];
  readonly categoryOverrides?: readonly Overwrite[];
  readonly channelOverrides?: readonly Overwrite[];
}

function isEveryoneRole(role: Role): boolean {
  return role.isEveryone === true || role.id === EVERYONE_ROLE_ID;
}

function applyOverwrites(
  current: bigint,
  heldRoleIds: ReadonlySet<string>,
  userId: string,
  overrides: readonly Overwrite[],
): bigint {
  let result = current;
  for (const override of overrides) {
    if (override.targetType === "role" && heldRoleIds.has(override.targetId)) {
      result &= ~override.deny;
    }
  }
  for (const override of overrides) {
    if (override.targetType === "role" && heldRoleIds.has(override.targetId)) {
      result |= override.allow;
    }
  }
  for (const override of overrides) {
    if (override.targetType === "member" && override.targetId === userId) {
      result &= ~override.deny;
    }
  }
  for (const override of overrides) {
    if (override.targetType === "member" && override.targetId === userId) {
      result |= override.allow;
    }
  }
  return result;
}

/**
 * Resolves the effective permissions for an actor in a channel.
 *
 * Order (per plan.md):
 * 1. Owner or Administrator -> all permissions.
 * 2. Start from `@everyone`, OR in every held role.
 * 3. Apply category overrides, then channel overrides; within each set the
 *    order is role-deny, role-allow, member-deny, member-allow.
 */
export function resolvePermissions(input: ResolvePermissionsInput): bigint {
  const { actor, roles } = input;
  if (actor.isOwner === true) {
    return ALL_PERMISSIONS;
  }

  const everyone = roles.find(isEveryoneRole);
  const heldRoleIds = new Set(actor.roleIds);
  if (everyone !== undefined) {
    heldRoleIds.add(everyone.id);
  }

  let permissions = 0n;
  for (const role of roles) {
    if (heldRoleIds.has(role.id)) {
      permissions |= role.permissions;
    }
  }

  if ((permissions & Permission.Administrator) !== 0n) {
    return ALL_PERMISSIONS;
  }

  permissions = applyOverwrites(
    permissions,
    heldRoleIds,
    actor.userId,
    input.categoryOverrides ?? [],
  );
  permissions = applyOverwrites(
    permissions,
    heldRoleIds,
    actor.userId,
    input.channelOverrides ?? [],
  );
  return permissions;
}

export interface ModeratorLike {
  readonly userId: string;
  readonly topRolePosition: number;
  readonly isOwner?: boolean;
}

/** Highest `position` among the roles the member holds; `-1` when none. */
export function highestRolePosition(roleIds: readonly string[], roles: readonly Role[]): number {
  let top = -1;
  const held = new Set(roleIds);
  for (const role of roles) {
    if (held.has(role.id)) {
      top = Math.max(top, role.position);
    }
  }
  return top;
}

/**
 * Hierarchy check for moderation actions: the target's top role must be
 * strictly below the actor's. Owners cannot be moderated, and nobody can
 * moderate themselves.
 */
export function canModerate(actor: ModeratorLike, target: ModeratorLike): boolean {
  if (actor.userId === target.userId) {
    return false;
  }
  if (target.isOwner === true) {
    return false;
  }
  if (actor.isOwner === true) {
    return true;
  }
  return actor.topRolePosition > target.topRolePosition;
}

/**
 * Whether an actor holding `actorPermissions` may grant `requested`. An
 * Administrator may grant anything; otherwise every requested bit must already
 * be held, so nobody can hand out power they do not have.
 */
export function canGrantPermissions(actorPermissions: bigint, requested: bigint): boolean {
  if ((actorPermissions & Permission.Administrator) !== 0n) {
    return true;
  }
  return (requested & ~actorPermissions) === 0n;
}

/**
 * Whether an actor may manage (edit, assign or delete) a role at
 * `targetPosition`. Owners may manage any role; everyone else may only manage
 * roles strictly below their own top role.
 */
export function canManageRole(actor: ModeratorLike, targetPosition: number): boolean {
  if (actor.isOwner === true) {
    return true;
  }
  return actor.topRolePosition > targetPosition;
}

export interface ModerateMemberInput {
  readonly actor: PermissionActor;
  readonly target: PermissionActor;
  readonly roles: readonly Role[];
}

/** Convenience wrapper that derives top positions from roles. */
export function canModerateMember(input: ModerateMemberInput): boolean {
  const actor: ModeratorLike = {
    userId: input.actor.userId,
    topRolePosition: highestRolePosition(input.actor.roleIds, input.roles),
    isOwner: input.actor.isOwner === true,
  };
  const target: ModeratorLike = {
    userId: input.target.userId,
    topRolePosition: highestRolePosition(input.target.roleIds, input.roles),
    isOwner: input.target.isOwner === true,
  };
  return canModerate(actor, target);
}
