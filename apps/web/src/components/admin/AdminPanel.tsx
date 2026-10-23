import type { ChannelSummary } from "@aulora/core";
import { hasPermission, Permission, type PermissionName } from "@aulora/core";
import { Icon, IconButton, Text } from "@aulora/ui-web";
import { useMemo, useState } from "react";
import {
  type CategoryView,
  type MemberView,
  memberDisplayName,
  type RoleView,
  roleRef,
} from "../../lib/workspace-admin";
import { AddonsSettings } from "./AddonsSettings";
import { AdminNav } from "./AdminNav";
import { AdminPageHeader } from "./AdminPageHeader";
import { AuditLogViewer } from "./AuditLogViewer";
import { BotsSettings } from "./bots/BotsSettings";
import type { Callback } from "./callbacks";
import { InviteManager } from "./InviteManager";
import { InstanceAdminPanel } from "./instance/InstanceAdminPanel";
import { MemberManager } from "./MemberManager";
import { PermissionsPanel, type ScopePage } from "./PermissionsPanel";
import { RoleEditor, type RolePage } from "./RoleEditor";
import { buildSections, type TabId } from "./sections";
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

type AdminPage = RolePage | ScopePage;

interface Nav {
  readonly tab: TabId;
  readonly page: AdminPage | null;
}

const PERMISSION_BITS = new Map<PermissionName, bigint>(
  Object.entries(Permission) as [PermissionName, bigint][],
);

interface AdminLookups {
  readonly memberNames: ReadonlyMap<string, string>;
  readonly roleNames: ReadonlyMap<string, string>;
  readonly categoryNames: ReadonlyMap<string, string>;
}

function useAdminLookups(
  roles: readonly RoleView[],
  members: readonly MemberView[],
  categories: readonly CategoryView[],
): AdminLookups {
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

  return { memberNames, roleNames, categoryNames };
}

function AdminPanelHeader({ onClose }: { readonly onClose: () => void }) {
  return (
    <header className="material-chrome flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3">
      <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-[-0.01em] text-text">
        Workspace settings
      </h2>
      <IconButton label="Close admin panel" onClick={onClose}>
        <Icon name="x" size={16} />
      </IconButton>
    </header>
  );
}

/**
 * Workspace settings: a grouped sidebar of admin pages next to one page at a
 * time, with page headers, inset lists and inline save rows. Every section
 * still obeys the same permission checks as before.
 */
export function AdminPanel(props: AdminPanelProps) {
  const { viewer, ownerId, roles, members, categories, channels, channelNames, origin, onClose } =
    props;
  const permission = (name: PermissionName): boolean =>
    hasPermission(viewer.permissions, PERMISSION_BITS.get(name) ?? 0n);

  const sections = buildSections(permission, viewer.isOwner);
  const { memberNames, roleNames, categoryNames } = useAdminLookups(roles, members, categories);

  const [nav, setNav] = useState<Nav>({ tab: sections[0]?.id ?? "roles", page: null });

  function goToTab(tab: TabId) {
    setNav({ tab, page: null });
  }

  return (
    <section
      className="pane flex h-full min-w-0 flex-1 flex-col bg-surface-1"
      data-testid="admin-panel"
      aria-label="Workspace settings"
    >
      <AdminPanelHeader onClose={onClose} />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <AdminNav sections={sections} active={nav.tab} onSelect={goToTab} />

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex w-full max-w-[784px] flex-col px-8 pb-20 pt-8 lg:px-12">
            <AdminPanelBody
              nav={nav}
              hasSections={sections.length > 0}
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
      </div>
    </section>
  );
}

interface AdminPanelBodyProps {
  readonly nav: Nav;
  readonly hasSections: boolean;
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

const SYSTEM_TABS = new Set<TabId>(["audit", "workspace", "addons", "bots", "instance"]);

function AdminPanelBody(props: AdminPanelBodyProps) {
  if (!props.hasSections) {
    return (
      <Text tone="muted" size="sm">
        You do not have access to any admin sections.
      </Text>
    );
  }
  if (SYSTEM_TABS.has(props.nav.tab)) {
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
          roles={roles}
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
          {...(permission("CreateInvites") || permission("DeleteInvites")
            ? {
                onOpenInvites: () => {
                  onNavigate("invites", null);
                },
              }
            : {})}
        />
      )}
      {nav.tab === "invites" && (
        <InviteManager
          canCreateInvites={permission("CreateInvites")}
          canDeleteInvites={permission("DeleteInvites")}
          origin={origin}
        />
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
          <AdminPageHeader
            title="General"
            description="Name, branding, how people join, and calling."
          />
          <WorkspaceBranding canManageWorkspace={permission("ManageWorkspace")} />
          <WorkspaceSettings canManageWorkspace={permission("ManageWorkspace")} />
        </div>
      )}
      {nav.tab === "addons" && (
        <AddonsSettings canManageWorkspace={permission("ManageWorkspace")} />
      )}
      {nav.tab === "bots" && <BotsSettings canManageBots={permission("ManageBots")} />}
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
