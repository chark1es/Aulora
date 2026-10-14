import { canManageRole, type PermissionName } from "@aulora/core";
import type { OverrideView } from "../../lib/workspace-admin";

/**
 * Pure helpers for the channel edit dialog's role-permission section. The
 * editor only ever touches `role`-target overrides; `member`-target overrides
 * (blocked users and explicit grants) are preserved untouched so saving roles
 * never wipes or duplicates them.
 */

/** A role the edit dialog can set an override on. */
export interface ChannelRoleOption {
  readonly id: string;
  readonly name: string;
  readonly color?: string | null;
  readonly position: number;
  readonly isEveryone?: boolean;
}

export interface ChannelPermissionGroup {
  readonly label: string;
  readonly permissions: readonly PermissionName[];
}

/** Channel-scoped permission flags, grouped for the role override editor. */
export const CHANNEL_PERMISSION_GROUPS = [
  { label: "General", permissions: ["ViewChannel", "ManageChannels", "ManageRoles"] },
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
  {
    label: "Voice",
    permissions: [
      "Connect",
      "Speak",
      "Stream",
      "UseVideo",
      "MuteMembers",
      "DeafenMembers",
      "MoveMembers",
    ],
  },
] as const satisfies readonly ChannelPermissionGroup[];

export interface ChannelRoleViewer {
  readonly isOwner: boolean;
  readonly topPosition: number;
}

/**
 * Whether the viewer may edit a role's channel override: owner, or a top role
 * strictly above the target's. Mirrors the server's `requireRoleManageable`.
 * Unlike the raw admin role editor this allows `@everyone` (position 0) once
 * the viewer outranks it.
 */
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

/** The role-target overrides in a channel's full override set. */
export function roleOverridesFor(overrides: readonly OverrideView[]): OverrideView[] {
  return overrides.filter((override) => override.targetType === "role");
}

/**
 * Rebuilds the full override set after a role edit: member overrides and
 * role overrides the editor does not manage are kept as-is, while the submitted
 * overrides replace every role in `managedRoleIds` (an emptied role is dropped
 * rather than written back as 0/0).
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
