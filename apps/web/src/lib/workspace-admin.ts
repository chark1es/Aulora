import {
  canManageRole,
  canModerateMember,
  type OverrideView,
  Permission,
  type PermissionName,
  type RoleView,
  roleColorFor,
  roleNamesFor,
  roleRef,
  toCoreRoles,
} from "@aulora/core";

export type { MemberView, OverrideView, ResolveViewerInput, RoleView } from "@aulora/core";
export {
  heldRoleIds,
  memberDisplayName,
  resolveViewerPermissions,
  toCoreRoles,
} from "@aulora/core";
export { roleColorFor, roleNamesFor, roleRef };

/**
 * Pure view helpers for the admin surfaces. Nothing here talks to the
 * server or holds secrets: it only reshapes role/member/override data already
 * returned by Convex and resolves the same bitfield the server enforces, so the
 * UI hides what the actor cannot do. The server remains the source of truth.
 */

export interface CategoryView {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  readonly overrides: readonly OverrideView[];
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

/** Permission flags grouped for the role editor, in their stable bitfield order. */
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
      "DeleteInvites",
      "ManageBots",
      "ManageWebhooks",
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
  { label: "Kanban", permissions: ["ViewKanban", "EditKanban", "CommentKanban", "ManageKanban"] },
  {
    label: "Notes",
    permissions: ["ViewNotes", "CreateNotes", "EditNotes", "DeleteNotes", "ManageNotes"],
  },
  {
    label: "Calls",
    permissions: [
      "StartTranscription",
      "ViewTranscripts",
      "ManageTranscription",
      "CreateGuestLinks",
      "ManageGuestAccess",
      "ScheduleCalls",
      "ManageScheduledCalls",
      "ViewScheduledCalls",
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
  DeleteInvites: "Delete invites",
  ManageBots: "Manage bots",
  ManageWebhooks: "Manage webhooks",
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
  Connect: "Join voice",
  Speak: "Speak",
  Stream: "Share screen",
  UseVideo: "Turn on camera",
  MuteMembers: "Mute members",
  DeafenMembers: "Deafen members",
  MoveMembers: "Move members",
  ViewKanban: "View Kanban boards",
  EditKanban: "Edit Kanban cards and track time",
  CommentKanban: "Comment on Kanban cards",
  ManageKanban: "Manage all boards, membership and comments",
  ViewNotes: "View notes and folders",
  CreateNotes: "Create notes and folders",
  EditNotes: "Edit notes, folders and tags",
  DeleteNotes: "Delete notes, folders and tags",
  ManageNotes: "Manage all notes and history",
  StartTranscription: "Start transcription in a call",
  ViewTranscripts: "Read transcripts and summaries",
  ManageTranscription: "Configure transcription and delete transcripts",
  CreateGuestLinks: "Create guest invite links",
  ManageGuestAccess: "Admit, deny or remove guests",
  ScheduleCalls: "Schedule calls",
  ManageScheduledCalls: "Manage anyone’s scheduled calls",
  ViewScheduledCalls: "See the Scheduled tab",
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

export const PERMISSION_LABELS_BY_NAME = new Map<string, string>(Object.entries(PERMISSION_LABELS));
export const PERMISSION_BITS = new Map<string, bigint>(Object.entries(Permission));
