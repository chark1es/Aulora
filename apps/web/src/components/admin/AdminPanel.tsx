import type { ChannelSummary } from "@aulora/core";
import { hasPermission, Permission, type PermissionName } from "@aulora/core";
import { Heading, Icon, IconButton, Text } from "@aulora/ui-web";
import { useMemo, useState } from "react";
import {
  type CategoryView,
  type MemberView,
  memberDisplayName,
  type RoleView,
  roleRef,
} from "../../lib/workspace-admin";
import { AddonsSettings } from "./AddonsSettings";
import { AuditLogViewer } from "./AuditLogViewer";
import { InviteManager } from "./InviteManager";
import { InstanceAdminPanel } from "./instance/InstanceAdminPanel";
import { MemberManager } from "./MemberManager";
import { PermissionsPanel, type ScopePage } from "./PermissionsPanel";
import { RoleEditor, type RolePage } from "./RoleEditor";
import { WorkspaceBranding } from "./WorkspaceBranding";
import { WorkspaceSettings } from "./WorkspaceSettings";

export interface AdminPanelViewer {
  readonly userId: string;
  readonly isOwner: boolean;
  readonly roleIds: readonly string[];
  readonly permissions: bigint;
  readonly topPosition: number;
}

export interface AdminPanelProps {
  readonly viewer: AdminPanelViewer;
  readonly ownerId: string | null;
  readonly roles: readonly RoleView[];
  readonly members: readonly MemberView[];
  readonly categories: readonly CategoryView[];
  readonly channels: readonly ChannelSummary[];
  readonly channelNames?: ReadonlyMap<string, string>;
  readonly origin: string;
  readonly onClose: () => void;
}

type TabId =
  | "roles"
  | "members"
  | "invites"
  | "permissions"
  | "audit"
  | "workspace"
  | "addons"
  | "instance";

type AdminPage = RolePage | ScopePage;

interface Nav {
  readonly tab: TabId;
  readonly page: AdminPage | null;
}

const TAB_LABELS: Record<TabId, string> = {
  roles: "Roles",
  members: "Members",
  invites: "Invites",
  permissions: "Permissions",
  audit: "Audit log",
  workspace: "Workspace",
  addons: "Addons",
  instance: "Instance",
};

/** The workspace admin console: roles, members, overrides and audit. */
export function AdminPanel({
  viewer,
  ownerId,
  roles,
  members,
  categories,
  channels,
  channelNames,
  onClose,
}: AdminPanelProps) {
  const permission = (name: PermissionName): boolean =>
    hasPermission(viewer.permissions, Permission[name]);

  const tabs: { id: TabId; label: string }[] = [];
  if (permission("ManageRoles")) {
    tabs.push({ id: "roles", label: "Roles" });
  }
  if (
    permission("ManageRoles") ||
    permission("Kick") ||
    permission("Ban") ||
    permission("Timeout") ||
    permission("ManageNicknames")
  ) {
    tabs.push({ id: "members", label: "Members" });
  }
  if (permission("CreateInvites")) {
    tabs.push({ id: "invites", label: "Invites" });
  }
  if (permission("ManageChannels")) {
    tabs.push({ id: "permissions", label: "Permissions" });
  }
  if (permission("ViewAuditLog")) {
    tabs.push({ id: "audit", label: "Audit log" });
  }
  if (permission("ManageWorkspace")) {
    tabs.push({ id: "workspace", label: "Workspace" });
    tabs.push({ id: "addons", label: "Addons" });
  }
  if (viewer.isOwner) {
    tabs.push({ id: "instance", label: "Instance" });
  }

  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      map.set(member.userId, memberDisplayName(member, member.userId));
    }
    return map;
  }, [members]);

  const roleNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const role of roles) {
      map.set(role.id, role.name);
      map.set(roleRef(role), role.name);
    }
    return map;
  }, [roles]);

  const categoryNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of categories) {
      map.set(category.id, category.name);
    }
    return map;
  }, [categories]);

  const [nav, setNav] = useState<Nav>({ tab: tabs[0]?.id ?? "roles", page: null });

  const drilled = nav.page !== null;

  function goToTab(tab: TabId) {
    setNav({ tab, page: null });
  }

  function goBack() {
    setNav({ tab: nav.tab, page: null });
  }

  return (
    <section
      className="pane flex h-full min-w-0 flex-1 flex-col bg-surface-1"
      data-testid="admin-panel"
      aria-label="Workspace admin"
    >
      <header className="material-chrome flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3">
        {drilled && (
          <IconButton label="Back" onClick={goBack}>
            <Icon name="chevron-left" size={16} />
          </IconButton>
        )}
        <Heading level={3} className="min-w-0 flex-1 truncate">
          {drilled ? TAB_LABELS[nav.tab] : "Workspace admin"}
        </Heading>
        {!drilled && viewer.isOwner && (
          <span
            className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent"
            data-testid="admin-owner-badge"
          >
            Admin
          </span>
        )}
        <IconButton label="Close admin panel" onClick={onClose}>
          <Icon name="x" size={16} />
        </IconButton>
      </header>

      <nav
        className="flex shrink-0 flex-wrap gap-1 border-b border-border px-3 py-2"
        aria-label="Admin sections"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-current={nav.tab === tab.id ? "page" : undefined}
            className={
              nav.tab === tab.id
                ? "rounded-[7px] bg-surface-3 px-3 py-1 text-[13px] font-medium text-text"
                : "rounded-[7px] px-3 py-1 text-[13px] text-text-muted transition hover:bg-surface-2 hover:text-text"
            }
            onClick={() => goToTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 p-5">
          {nav.tab === "roles" && (
            <RoleEditor
              viewer={viewer}
              canManageRoles={permission("ManageRoles")}
              page={isRolePage(nav.page) ? nav.page : null}
              onNavigate={(page) => setNav({ tab: "roles", page })}
            />
          )}
          {nav.tab === "members" && (
            <MemberManager
              viewer={viewer}
              ownerId={ownerId}
              permissions={{
                manageRoles: permission("ManageRoles"),
                kick: permission("Kick"),
                ban: permission("Ban"),
                timeout: permission("Timeout"),
                manageNicknames: permission("ManageNicknames"),
                changeOwnNickname: permission("ChangeOwnNickname"),
              }}
            />
          )}
          {nav.tab === "invites" && (
            <InviteManager canCreateInvites={permission("CreateInvites")} origin={origin} />
          )}
          {nav.tab === "permissions" && (
            <PermissionsPanel
              roles={roles}
              members={members}
              categories={categories}
              channels={channels}
              {...(channelNames !== undefined ? { channelNames } : {})}
              page={isScopePage(nav.page) ? nav.page : null}
              onNavigate={(page) => setNav({ tab: "permissions", page })}
            />
          )}
          {nav.tab === "audit" && (
            <AuditLogViewer
              canViewAuditLog={permission("ViewAuditLog")}
              memberNames={memberNames}
              roleNames={roleNames}
              categoryNames={categoryNames}
              {...(channelNames !== undefined ? { channelNames } : {})}
            />
          )}
          {nav.tab === "workspace" && (
            <div className="flex flex-col gap-8" data-testid="settings-workspace">
              <WorkspaceBranding canManageWorkspace={permission("ManageWorkspace")} />
              <WorkspaceSettings canManageWorkspace={permission("ManageWorkspace")} />
            </div>
          )}
          {nav.tab === "addons" && (
            <AddonsSettings canManageWorkspace={permission("ManageWorkspace")} />
          )}
          {nav.tab === "instance" && (
            <InstanceAdminPanel canManage={viewer.isOwner} variant="inline" />
          )}
          {tabs.length === 0 && (
            <Text tone="muted" size="sm">
              You do not have access to any admin sections.
            </Text>
          )}
        </div>
      </div>
    </section>
  );
}

function isRolePage(page: AdminPage | null): page is RolePage {
  return page !== null && (page.kind === "role" || page.kind === "role-create");
}

function isScopePage(page: AdminPage | null): page is ScopePage {
  return page !== null && page.kind === "scope";
}
