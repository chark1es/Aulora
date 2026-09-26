import type { ChannelSummary } from "@aulora/core";
import { hasPermission, Permission, type PermissionName } from "@aulora/core";
import { Button, Heading, IconButton, Text } from "@aulora/ui-web";
import { useMutation } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import {
  type CategoryView,
  type MemberView,
  memberDisplayName,
  type OverrideTarget,
  type OverrideView,
  type RoleView,
  roleRef,
} from "../../lib/workspace-admin";
import { AuditLogViewer } from "./AuditLogViewer";
import { InvitesPanel } from "./InvitesPanel";
import { MemberManager } from "./MemberManager";
import { OverridesEditor } from "./OverridesEditor";
import { RoleEditor } from "./RoleEditor";
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

type TabId = "roles" | "members" | "permissions" | "invites" | "audit" | "settings";

interface Scope {
  readonly kind: "category" | "channel";
  readonly id: string;
  readonly name: string;
}

/** The workspace admin console: roles, members, overrides, invites, audit. */
export function AdminPanel({
  viewer,
  ownerId,
  roles,
  members,
  categories,
  channels,
  channelNames,
  origin,
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
  if (permission("ManageChannels")) {
    tabs.push({ id: "permissions", label: "Permissions" });
  }
  if (permission("CreateInvites")) {
    tabs.push({ id: "invites", label: "Invites" });
  }
  if (permission("ViewAuditLog")) {
    tabs.push({ id: "audit", label: "Audit log" });
  }
  if (permission("ManageWorkspace")) {
    tabs.push({ id: "settings", label: "Settings" });
  }

  const [active, setActive] = useState<TabId>(tabs[0]?.id ?? "roles");

  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      map.set(member.userId, memberDisplayName(member, member.userId));
    }
    return map;
  }, [members]);

  const targets: OverrideTarget[] = useMemo(
    () => [
      ...[...roles]
        .sort((a, b) => b.position - a.position)
        .map((role) => ({
          targetId: roleRef(role),
          targetType: "role" as const,
          label: role.name,
          color: role.color,
        })),
      ...members.map((member) => ({
        targetId: member.userId,
        targetType: "member" as const,
        label: memberDisplayName(member, member.userId),
      })),
    ],
    [roles, members],
  );

  const scopes: Scope[] = useMemo(
    () => [
      ...[...categories]
        .sort((a, b) => a.position - b.position)
        .map((category) => ({
          kind: "category" as const,
          id: category.id,
          name: `Category · ${category.name}`,
        })),
      ...channels
        .filter((channel) => channel.kind === "text" || channel.kind === "announcement")
        .map((channel) => ({
          kind: "channel" as const,
          id: channel.id,
          name: `Channel · ${channelNames?.get(channel.id) ?? channel.id}`,
        })),
    ],
    [categories, channels, channelNames],
  );

  const [scopeKey, setScopeKey] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [overridesError, setOverridesError] = useState<string | null>(null);
  const setCategoryOverrides = useMutation(api.categories.setOverrides);
  const setChannelOverrides = useMutation(api.channels.setOverrides);

  const scope = scopes.find((entry) => `${entry.kind}:${entry.id}` === scopeKey) ?? null;
  const currentOverrides: readonly OverrideView[] =
    scope === null
      ? []
      : scope.kind === "category"
        ? (categories.find((category) => category.id === scope.id)?.overrides ?? [])
        : (channels.find((channel) => channel.id === scope.id)?.overrides ?? []);

  async function saveOverrides(next: readonly OverrideView[]): Promise<void> {
    if (scope === null) {
      return;
    }
    setBusy(true);
    setOverridesError(null);
    try {
      const payload = next.map((override) => ({
        targetId: override.targetId,
        targetType: override.targetType,
        allow: override.allow,
        deny: override.deny,
      }));
      if (scope.kind === "category") {
        await setCategoryOverrides({ categoryId: scope.id as never, overrides: payload });
      } else {
        await setChannelOverrides({ channelId: scope.id as never, overrides: payload });
      }
    } catch (cause) {
      setOverridesError(cause instanceof Error ? cause.message : "Could not save overrides.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex justify-end bg-bg/70"
      data-testid="admin-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Workspace admin"
    >
      <div className="flex h-full w-full max-w-3xl flex-col border-l border-border bg-surface-1">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <Heading level={2}>Workspace admin</Heading>
          <IconButton label="Close admin panel" onClick={onClose}>
            <span aria-hidden="true">✕</span>
          </IconButton>
        </header>
        <nav
          className="flex flex-wrap gap-1 border-b border-border px-4 py-2"
          aria-label="Admin sections"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-current={active === tab.id ? "page" : undefined}
              className={
                active === tab.id
                  ? "rounded-pill bg-surface-3 px-3 py-1 text-sm text-text"
                  : "rounded-pill px-3 py-1 text-sm text-text-muted hover:bg-surface-2 hover:text-text"
              }
              onClick={() => setActive(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {active === "roles" && (
            <RoleEditor viewer={viewer} canManageRoles={permission("ManageRoles")} />
          )}
          {active === "members" && (
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
          {active === "permissions" && (
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm text-text-muted">
                Category or channel
                <select
                  aria-label="Override scope"
                  className="h-10 rounded-input border border-border bg-surface-3 px-3 text-base text-text"
                  value={scopeKey}
                  onChange={(event) => {
                    setScopeKey(event.currentTarget.value);
                    setOverridesError(null);
                  }}
                >
                  <option value="">Select a category or channel…</option>
                  {scopes.map((entry) => (
                    <option key={`${entry.kind}:${entry.id}`} value={`${entry.kind}:${entry.id}`}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              {scope === null ? (
                <Text tone="muted" size="sm">
                  Choose a category or channel to edit its permission overrides.
                </Text>
              ) : (
                <OverridesEditor
                  title={scope.name}
                  overrides={currentOverrides}
                  targets={targets}
                  onSave={saveOverrides}
                  busy={busy}
                  error={overridesError}
                  testId="admin-overrides"
                />
              )}
            </div>
          )}
          {active === "invites" && (
            <InvitesPanel canCreateInvites={permission("CreateInvites")} origin={origin} />
          )}
          {active === "audit" && (
            <AuditLogViewer
              canViewAuditLog={permission("ViewAuditLog")}
              memberNames={memberNames}
            />
          )}
          {active === "settings" && (
            <WorkspaceSettings canManageWorkspace={permission("ManageWorkspace")} />
          )}
          {tabs.length === 0 && (
            <Text tone="muted" size="sm">
              You do not have access to any admin sections.
            </Text>
          )}
          <div className="mt-6">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
