import { canManageRole, type Overwrite, Permission, type PermissionName } from "@aulora/core";

/**
 * Pure helpers for the mobile channel-edit role permissions section, mirroring
 * `apps/web/src/components/chat/channel-role-overrides.ts`. Only `role`-target
 * overrides are edited here; `member`-target overrides (blocked users and
 * explicit grants) are preserved untouched.
 */

export type OverrideView = Overwrite;
export type OverrideLevel = "inherit" | "allow" | "deny";

const PERMISSION_BITS = new Map<string, bigint>(Object.entries(Permission));

/** A role the edit sheet can set an override on. */
export interface ChannelRoleOption {
  readonly id: string;
  readonly name: string;
  readonly color?: string | null;
  readonly position: number;
  readonly isEveryone?: boolean;
}

export interface ChannelPermission {
  readonly name: PermissionName;
  readonly label: string;
}

export interface ChannelPermissionGroup {
  readonly label: string;
  readonly permissions: readonly ChannelPermission[];
}

/** Channel-scoped permission flags, grouped for the role override editor. */
export const CHANNEL_PERMISSION_GROUPS: readonly ChannelPermissionGroup[] = [
  {
    label: "General",
    permissions: [
      { name: "ViewChannel", label: "View channel" },
      { name: "ManageChannels", label: "Manage channel" },
      { name: "ManageRoles", label: "Manage roles" },
    ],
  },
  {
    label: "Messages",
    permissions: [
      { name: "SendMessages", label: "Send messages" },
      { name: "SendInThreads", label: "Send in threads" },
      { name: "CreateThreads", label: "Create threads" },
      { name: "AttachFiles", label: "Attach files" },
      { name: "EmbedLinks", label: "Embed links" },
      { name: "AddReactions", label: "Add reactions" },
      { name: "MentionEveryone", label: "Mention everyone" },
      { name: "ManageMessages", label: "Manage messages" },
      { name: "PinMessages", label: "Pin messages" },
      { name: "ReadHistory", label: "Read history" },
    ],
  },
  {
    label: "Voice",
    permissions: [
      { name: "Connect", label: "Join voice" },
      { name: "Speak", label: "Speak" },
      { name: "Stream", label: "Share screen" },
      { name: "UseVideo", label: "Turn on camera" },
      { name: "MuteMembers", label: "Mute members" },
      { name: "DeafenMembers", label: "Deafen members" },
      { name: "MoveMembers", label: "Move members" },
    ],
  },
];

interface OverrideTarget {
  readonly targetId: string;
  readonly targetType: "role" | "member";
}

function flagFor(name: PermissionName): bigint {
  return PERMISSION_BITS.get(name) ?? 0n;
}

/** The current level for one target + flag in an override set. */
export function overrideLevel(
  overrides: readonly OverrideView[],
  target: OverrideTarget,
  name: PermissionName,
): OverrideLevel {
  const match = overrides.find(
    (override) =>
      override.targetId === target.targetId && override.targetType === target.targetType,
  );
  if (match === undefined) {
    return "inherit";
  }
  const flag = flagFor(name);
  if ((match.allow & flag) !== 0n) {
    return "allow";
  }
  if ((match.deny & flag) !== 0n) {
    return "deny";
  }
  return "inherit";
}

/**
 * Applies an override level for one flag, keeping `allow`/`deny` disjoint. The
 * server rejects a flag that is both allowed and denied, so each transition
 * clears the opposite bit. A target emptied to 0/0 is dropped.
 */
export function setOverrideLevel(
  overrides: readonly OverrideView[],
  target: OverrideTarget,
  name: PermissionName,
  level: OverrideLevel,
): OverrideView[] {
  const flag = flagFor(name);
  const index = overrides.findIndex(
    (override) =>
      override.targetId === target.targetId && override.targetType === target.targetType,
  );
  const current = index >= 0 ? overrides.at(index) : undefined;
  let allow = (current?.allow ?? 0n) & ~flag;
  let deny = (current?.deny ?? 0n) & ~flag;
  if (level === "allow") {
    allow |= flag;
  } else if (level === "deny") {
    deny |= flag;
  }
  const next = overrides.filter((_, i) => i !== index);
  if (allow !== 0n || deny !== 0n) {
    next.push({ targetId: target.targetId, targetType: target.targetType, allow, deny });
  }
  return next;
}

/** The role-target overrides in a channel's full override set. */
export function roleOverridesFor(overrides: readonly OverrideView[]): OverrideView[] {
  return overrides.filter((override) => override.targetType === "role");
}

/**
 * Rebuilds the full override set after a role edit: member overrides and role
 * overrides the editor does not manage are kept as-is, while the submitted
 * overrides replace every role in `managedRoleIds`.
 */
export function mergeRoleOverrides(
  current: readonly OverrideView[],
  submitted: readonly OverrideView[],
  managedRoleIds: ReadonlySet<string>,
): OverrideView[] {
  const untouched = current.filter(
    (override) =>
      override.targetType === "member" ||
      (override.targetType === "role" && !managedRoleIds.has(override.targetId)),
  );
  const replaced = submitted.filter(
    (override) =>
      override.targetType === "role" &&
      managedRoleIds.has(override.targetId) &&
      (override.allow !== 0n || override.deny !== 0n),
  );
  return [...untouched, ...replaced];
}

/** Whether two override sets are equal by target and allow/deny bits. */
export function sameOverrides(a: readonly OverrideView[], b: readonly OverrideView[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const byKey = new Map(b.map((override) => [overrideKey(override), override] as const));
  for (const override of a) {
    const other = byKey.get(overrideKey(override));
    if (other === undefined || other.allow !== override.allow || other.deny !== override.deny) {
      return false;
    }
  }
  return true;
}

function overrideKey(override: OverrideView): string {
  return `${override.targetType}:${override.targetId}`;
}

export interface ChannelRoleViewer {
  readonly isOwner: boolean;
  readonly topPosition: number;
}

/** Mirrors the server's role hierarchy check, including `@everyone`. */
export function canEditChannelRole(viewer: ChannelRoleViewer, role: ChannelRoleOption): boolean {
  return canManageRole(
    {
      userId: "viewer",
      topRolePosition: viewer.topPosition,
      isOwner: viewer.isOwner,
    },
    role.position,
  );
}

/** A stored role, as returned by `roles.list` and the mobile chat provider. */
export interface ChannelRoleSource {
  readonly id: string;
  readonly key: string | null;
  readonly name: string;
  readonly color: string | null;
  readonly position: number;
  readonly isEveryone: boolean;
}

/**
 * The roles the viewer may override, mapped for the editor. Unmanageable roles
 * are omitted so the editor never submits an override it cannot justify;
 * callers preserve their existing overrides when merging.
 */
export function manageableChannelRoles(
  roles: readonly ChannelRoleSource[],
  viewer: ChannelRoleViewer,
): ChannelRoleOption[] {
  const options: ChannelRoleOption[] = [];
  for (const role of roles) {
    const option: ChannelRoleOption = {
      id: role.key ?? role.id,
      name: role.name,
      color: role.color,
      position: role.position,
      isEveryone: role.isEveryone,
    };
    if (canEditChannelRole(viewer, option)) {
      options.push(option);
    }
  }
  return options;
}
