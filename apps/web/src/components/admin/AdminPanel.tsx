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
import type { Callback } from "./callbacks";
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

interface AdminTab {
  readonly id: TabId;
  readonly label: string;
}

const TAB_LABELS = new Map<TabId, string>([
  ["roles", "Roles"],
  ["members", "Members"],
  ["invites", "Invites"],
  ["permissions", "Permissions"],
  ["audit", "Audit log"],
  ["workspace", "Workspace"],
  ["addons", "Addons"],
  ["instance", "Instance"],
]);

const PERMISSION_BITS = new Map<PermissionName, bigint>(
  Object.entries(Permission) as [PermissionName, bigint][],
);

function buildTabs(
  permission: Callback<[name: PermissionName], boolean>,
  isOwner: boolean,
): AdminTab[] {
  const tabs: AdminTab[] = [];
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
  if (isOwner) {
    tabs.push({ id: "instance", label: "Instance" });
  }
  return tabs;
}

/** The workspace admin console: roles, members, overrides and audit. */
export function AdminPanel(props: AdminPanelProps) {
  const { viewer, ownerId, roles, members, categories, channels, channelNames, origin, onClose } =
    props;
  const permission = (name: PermissionName): boolean =>
    hasPermission(viewer.permissions, PERMISSION_BITS.get(name) ?? 0n);

  const tabs = buildTabs(permission, viewer.isOwner);

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
      <AdminPanelHeader
        drilled={drilled}
        tab={nav.tab}
        isOwner={viewer.isOwner}
        tabs={tabs}
        onGoToTab={goToTab}
        onBack={goBack}
        onClose={onClose}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 p-5">
          <AdminPanelBody
            nav={nav}
            tabs={tabs}
            permission={permission}
            viewer={viewer}
            ownerId={ownerId}
            roles={roles}
            members={members}
            categories={categories}
            channels={channels}
            {...(channelNames !== undefined ? { channelNames } : {})}
            origin={origin}
            memberNames={memberNames}
            roleNames={roleNames}
            categoryNames={categoryNames}
            onNavigate={(tab, page) => {
              setNav({ tab, page });
            }}
          />
        </div>
      </div>
    </section>
  );
}

interface AdminPanelHeaderProps {
  readonly drilled: boolean;
  readonly tab: TabId;
  readonly isOwner: boolean;
  readonly tabs: readonly AdminTab[];
  readonly onGoToTab: Callback<[tab: TabId]>;
  readonly onBack: () => void;
  readonly onClose: () => void;
}

function AdminPanelHeader(props: AdminPanelHeaderProps) {
  const { drilled, tab, isOwner, tabs, onGoToTab, onBack, onClose } = props;
  return (
    <>
      <header className="material-chrome flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3">
        {drilled && (
          <IconButton label="Back" onClick={onBack}>
            <Icon name="chevron-left" size={16} />
          </IconButton>
        )}
        <Heading level={3} className="min-w-0 flex-1 truncate">
          {drilled ? (TAB_LABELS.get(tab) ?? "Workspace admin") : "Workspace admin"}
        </Heading>
        {!drilled && isOwner && (
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
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-current={tab === entry.id ? "page" : undefined}
            className={
              tab === entry.id
                ? "rounded-[7px] bg-surface-3 px-3 py-1 text-[13px] font-medium text-text"
                : "rounded-[7px] px-3 py-1 text-[13px] text-text-muted transition hover:bg-surface-2 hover:text-text"
            }
            onClick={() => {
              onGoToTab(entry.id);
            }}
          >
            {entry.label}
          </button>
        ))}
      </nav>
    </>
  );
}

interface AdminPanelBodyProps {
  readonly nav: Nav;
  readonly tabs: readonly AdminTab[];
  readonly permission: Callback<[name: PermissionName], boolean>;
  readonly viewer: AdminPanelViewer;
  readonly ownerId: string | null;
  readonly roles: readonly RoleView[];
  readonly members: readonly MemberView[];
  readonly categories: readonly CategoryView[];
  readonly channels: readonly ChannelSummary[];
  readonly channelNames?: ReadonlyMap<string, string>;
  readonly origin: string;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly roleNames: ReadonlyMap<string, string>;
  readonly categoryNames: ReadonlyMap<string, string>;
  readonly onNavigate: Callback<[tab: TabId, page: AdminPage | null]>;
}

function AdminPanelBody(props: AdminPanelBodyProps) {
  if (props.tabs.length === 0) {
    return (
      <Text tone="muted" size="sm">
        You do not have access to any admin sections.
      </Text>
    );
  }
  if (
    props.nav.tab === "audit" ||
    props.nav.tab === "workspace" ||
    props.nav.tab === "addons" ||
    props.nav.tab === "instance"
  ) {
    return <AdminPanelSystemBody {...props} />;
  }
  return <AdminPanelWorkspaceBody {...props} />;
}

function AdminPanelWorkspaceBody(props: AdminPanelBodyProps) {
  const {
    nav,
    permission,
    viewer,
    ownerId,
    roles,
    members,
    categories,
    channels,
    channelNames,
    origin,
    onNavigate,
  } = props;
  return (
    <>
      {nav.tab === "roles" && (
        <RoleEditor
          viewer={viewer}
          canManageRoles={permission("ManageRoles")}
          page={isRolePage(nav.page) ? nav.page : null}
          onNavigate={(page) => {
            onNavigate("roles", page);
          }}
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
          onNavigate={(page) => {
            onNavigate("permissions", page);
          }}
        />
      )}
    </>
  );
}

function AdminPanelSystemBody(props: AdminPanelBodyProps) {
  const { nav, permission, viewer, channelNames, memberNames, roleNames, categoryNames } = props;
  return (
    <>
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
      {nav.tab === "instance" && <InstanceAdminPanel canManage={viewer.isOwner} variant="inline" />}
    </>
  );
}

function isRolePage(page: AdminPage | null): page is RolePage {
  return page !== null && (page.kind === "role" || page.kind === "role-create");
}

function isScopePage(page: AdminPage | null): page is ScopePage {
  return page !== null && page.kind === "scope";
}
