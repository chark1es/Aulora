import type { IconName } from "@aulora/tokens";
import { Button, Icon, Text } from "@aulora/ui-web";
import { useQuery } from "convex/react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { InstanceAdminPanel } from "./instance/InstanceAdminPanel";
import { SettingsSectionHeader } from "./SettingsSection";
import { WorkspaceSettings } from "./WorkspaceSettings";

export type SettingsGroupId = "joining" | "overview" | "storage" | "access" | "instance";

export interface SettingsPage {
  readonly kind: "settings";
  readonly group: SettingsGroupId;
}

export interface SettingsHubProps {
  readonly canManageWorkspace: boolean;
  /** Instance settings are shown only to the workspace owner (instance admin). */
  readonly isInstanceAdmin?: boolean;
  readonly page?: SettingsPage | null;
  readonly onNavigate?: (page: SettingsPage | null) => void;
  /** Lets the hub cross-link to the Members and Roles tabs. */
  readonly onGoToTab?: (tab: "roles" | "members") => void;
}

interface SettingsGroup {
  readonly id: SettingsGroupId;
  readonly title: string;
  readonly description: string;
  readonly icon: IconName;
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: "joining",
    title: "Joining",
    description: "Sign-up, invite policy and allowed email domains.",
    icon: "user-plus",
  },
  {
    id: "overview",
    title: "Overview",
    description: "Workspace name, icon seed and owner.",
    icon: "shield",
  },
  {
    id: "storage",
    title: "Storage & uploads",
    description: "How this deployment stores attachments.",
    icon: "file",
  },
  {
    id: "access",
    title: "Members & access",
    description: "Jump to member moderation and role management.",
    icon: "users",
  },
  {
    id: "instance",
    title: "Instance",
    description: "Server status, storage, backups, push relay and licensing.",
    icon: "shield",
  },
];

export function settingsGroupLabel(id: SettingsGroupId): string {
  return SETTINGS_GROUPS.find((group) => group.id === id)?.title ?? "Settings";
}

/**
 * The Settings tab's hub: a grid of focused groups. Each card opens its own
 * page so the hub stays a calm index instead of one long settings form. The
 * glyph tile and gentle staggered rise give the index a sense of place without
 * ornament.
 */
export function SettingsHub({
  canManageWorkspace,
  isInstanceAdmin = false,
  page = null,
  onNavigate,
  onGoToTab,
}: SettingsHubProps) {
  const navigate = onNavigate ?? (() => undefined);
  const group = page?.group ?? null;
  const groups = isInstanceAdmin
    ? SETTINGS_GROUPS
    : SETTINGS_GROUPS.filter((entry) => entry.id !== "instance");

  if (group === "joining") {
    return <WorkspaceSettings canManageWorkspace={canManageWorkspace} />;
  }
  if (group === "overview") {
    return <SettingsOverview />;
  }
  if (group === "storage") {
    return <SettingsStorage />;
  }
  if (group === "access") {
    return <SettingsAccess canManageWorkspace={canManageWorkspace} onGoToTab={onGoToTab} />;
  }
  if (group === "instance") {
    return <InstanceAdminPanel canManage={isInstanceAdmin} variant="inline" />;
  }

  return (
    <div className="flex flex-col gap-5" data-testid="settings-hub">
      <SettingsSectionHeader
        icon="settings"
        title="Settings"
        description="Focused groups for how this workspace is configured."
      />

      <div className="grid gap-2.5 sm:grid-cols-2">
        {groups.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => navigate({ kind: "settings", group: entry.id })}
            style={{ animationDelay: `${index * 30}ms` }}
            className="group flex animate-slide-up items-center gap-3.5 rounded-[12px] border border-border bg-surface-2 p-3.5 text-left transition hover:border-text-muted/30 hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border border-border bg-surface-1 text-text-muted transition group-hover:border-accent/30 group-hover:text-accent">
              <Icon name={entry.icon} size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-text">{entry.title}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-text-muted">
                {entry.description}
              </span>
            </span>
            <Icon
              name="chevron-right"
              size={14}
              className="shrink-0 text-text-muted/60 transition group-hover:translate-x-0.5 group-hover:text-text"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

function monogram(name: string): string {
  const first = name.trim().charAt(0);
  return first.length > 0 ? first.toUpperCase() : "W";
}

function SettingsOverview() {
  const server = useQuery(api.server.settings, {});

  if (server === undefined) {
    return (
      <Text size="sm" tone="muted">
        Loading…
      </Text>
    );
  }

  const rows: readonly { readonly label: string; readonly value: string }[] = [
    { label: "Owner", value: server.ownerId },
    {
      label: "How people join",
      value: server.settings.inviteOnly ? "Invite only" : "Open to anyone",
    },
    {
      label: "Allowed domains",
      value:
        server.settings.allowedEmailDomains.length === 0
          ? "Any email domain"
          : server.settings.allowedEmailDomains.map((domain) => `@${domain}`).join(", "),
    },
  ];

  return (
    <div className="flex flex-col gap-5" data-testid="settings-overview">
      <SettingsSectionHeader
        icon="shield"
        title="Overview"
        description="Read-only details for this workspace."
      />

      <div className="flex items-center gap-3.5 rounded-[12px] border border-border bg-surface-2 p-4">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] bg-accent-soft text-lg font-semibold text-accent"
        >
          {monogram(server.name)}
        </span>
        <div className="min-w-0 flex-1">
          <Text size="md" className="truncate font-semibold">
            {server.name}
          </Text>
          <Text size="xs" tone="muted" className="truncate">
            Icon seed {server.iconSeed}
          </Text>
        </div>
        <span
          className={
            server.settings.inviteOnly
              ? "shrink-0 rounded-full border border-border bg-surface-3 px-2.5 py-0.5 text-[11px] font-medium text-text-muted"
              : "shrink-0 rounded-full border border-accent/25 bg-accent-soft px-2.5 py-0.5 text-[11px] font-medium text-accent"
          }
        >
          {server.settings.inviteOnly ? "Invite only" : "Open"}
        </span>
      </div>

      <dl className="divide-y divide-border overflow-hidden rounded-[12px] border border-border bg-surface-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-6 px-4 py-2.5 transition hover:bg-surface-3/50"
          >
            <dt className="text-[12px] text-text-muted">{row.label}</dt>
            <dd className="min-w-0 truncate text-right text-[12px] font-medium text-text">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SettingsStorage() {
  return (
    <div className="flex flex-col gap-5" data-testid="settings-storage">
      <SettingsSectionHeader
        icon="file"
        title="Storage &amp; uploads"
        description="Attachments are stored by this deployment."
      />
      <div className="flex items-start gap-3 rounded-[12px] border border-dashed border-border bg-surface-2/60 p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-3 text-text-muted">
          <Icon name="file" size={17} />
        </span>
        <div className="flex flex-col gap-1">
          <Text size="sm" className="font-medium">
            No per-workspace quota is exposed
          </Text>
          <Text size="sm" tone="muted">
            The admin API does not report storage usage, so there is nothing to tune here yet.
          </Text>
        </div>
      </div>
    </div>
  );
}

function SettingsAccess({
  canManageWorkspace,
  onGoToTab,
}: {
  readonly canManageWorkspace: boolean;
  onGoToTab?: ((tab: "roles" | "members") => void) | undefined;
}) {
  return (
    <div className="flex flex-col gap-5" data-testid="settings-access">
      <SettingsSectionHeader
        icon="users"
        title="Members &amp; access"
        description="Manage people and what they are allowed to do."
      />
      <div className="grid gap-2.5 sm:grid-cols-2">
        <AccessCard
          icon="users"
          title="Members"
          description="Roles, nicknames, timeouts, kick and ban."
          actionLabel="Open members"
          disabled={onGoToTab === undefined}
          onSelect={() => onGoToTab?.("members")}
        />
        <AccessCard
          icon="shield"
          title="Roles"
          description="Create roles and assign permissions."
          actionLabel="Open roles"
          disabled={onGoToTab === undefined}
          onSelect={() => onGoToTab?.("roles")}
        />
      </div>
      {!canManageWorkspace && (
        <Text size="xs" tone="muted">
          Some settings are read-only without the Manage workspace permission.
        </Text>
      )}
    </div>
  );
}

function AccessCard({
  icon,
  title,
  description,
  actionLabel,
  disabled,
  onSelect,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-border bg-surface-2 p-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-border bg-surface-1 text-text-muted">
        <Icon name={icon} size={17} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="block text-[13px] font-medium text-text">{title}</span>
        <span className="block text-[11px] leading-snug text-text-muted">{description}</span>
      </div>
      <Button variant="secondary" size="sm" disabled={disabled} onClick={onSelect}>
        {actionLabel}
      </Button>
    </div>
  );
}
