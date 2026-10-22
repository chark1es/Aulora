/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { PermissionName } from "@aulora/core";
import type { IconName } from "@aulora/tokens";

export type AdminGroupId = "workspace" | "people" | "channels" | "server";

export type TabId =
  | "roles"
  | "members"
  | "invites"
  | "permissions"
  | "audit"
  | "workspace"
  | "addons"
  | "bots"
  | "instance";

export type PermissionCheck = (name: PermissionName) => boolean;

export interface AdminSection {
  readonly id: TabId;
  readonly label: string;
  readonly group: AdminGroupId;
  readonly icon: IconName;
}

export const ADMIN_GROUPS: readonly { readonly id: AdminGroupId; readonly label: string }[] = [
  { id: "workspace", label: "Workspace" },
  { id: "people", label: "People" },
  { id: "channels", label: "Channels" },
  { id: "server", label: "Server" },
];

interface SectionDefinition extends AdminSection {
  readonly allowed: (permission: PermissionCheck, isOwner: boolean) => boolean;
}

/**
 * Every settings page in sidebar order, with the permission that opens it.
 * The order is the reading order: workspace setup, then people, then channels,
 * then owner-only server concerns.
 */
const SECTION_DEFINITIONS: readonly SectionDefinition[] = [
  {
    id: "workspace",
    label: "General",
    group: "workspace",
    icon: "settings",
    allowed: (permission) => permission("ManageWorkspace"),
  },
  {
    id: "addons",
    label: "Addons",
    group: "workspace",
    icon: "grid",
    allowed: (permission) => permission("ManageWorkspace"),
  },
  {
    id: "bots",
    label: "Bots",
    group: "workspace",
    icon: "code",
    allowed: (permission) => permission("ManageBots"),
  },
  {
    id: "members",
    label: "Members",
    group: "people",
    icon: "users",
    allowed: (permission) =>
      permission("ManageRoles") ||
      permission("Kick") ||
      permission("Ban") ||
      permission("Timeout") ||
      permission("ManageNicknames"),
  },
  {
    id: "roles",
    label: "Roles",
    group: "people",
    icon: "shield",
    allowed: (permission) => permission("ManageRoles"),
  },
  {
    id: "invites",
    label: "Invites",
    group: "people",
    icon: "link",
    allowed: (permission) => permission("CreateInvites") || permission("DeleteInvites"),
  },
  {
    id: "permissions",
    label: "Permissions",
    group: "channels",
    icon: "lock",
    allowed: (permission) => permission("ManageChannels"),
  },
  {
    id: "instance",
    label: "Instance",
    group: "server",
    icon: "desktop",
    allowed: (_, isOwner) => isOwner,
  },
  {
    id: "audit",
    label: "Audit log",
    group: "server",
    icon: "history",
    allowed: (permission) => permission("ViewAuditLog"),
  },
];

const FALLBACK_LABELS = new Map<TabId, string>(
  SECTION_DEFINITIONS.map((section) => [section.id, section.label]),
);

/** The sections this viewer may open, in sidebar order. */
export function buildSections(permission: PermissionCheck, isOwner: boolean): AdminSection[] {
  return SECTION_DEFINITIONS.filter((section) => section.allowed(permission, isOwner)).map(
    ({ id, label, group, icon }) => ({ id, label, group, icon }),
  );
}

export function sectionLabel(id: TabId): string {
  return FALLBACK_LABELS.get(id) ?? "Settings";
}
