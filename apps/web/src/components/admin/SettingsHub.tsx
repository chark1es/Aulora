import type { IconName } from "@aulora/tokens";
import { Icon } from "@aulora/ui-web";
import { useWorkspaceUpdates } from "../../providers/WorkspaceUpdateProvider";
import { AddonsSettings } from "./AddonsSettings";
import { InstanceAdminPanel } from "./instance/InstanceAdminPanel";
import { SettingsSectionHeader } from "./SettingsSection";
import { WorkspaceBranding } from "./WorkspaceBranding";
import { WorkspaceSettings } from "./WorkspaceSettings";

export type SettingsGroupId = "workspace" | "addons" | "instance";

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
}

interface SettingsGroup {
  readonly id: SettingsGroupId;
  readonly title: string;
  readonly description: string;
  readonly icon: IconName;
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: "workspace",
    title: "Workspace",
    description: "Name, branding, how people join, and calling policy.",
    icon: "shield",
  },
  {
    id: "addons",
    title: "Addons",
    description: "Optional workspace tools, including Kanban.",
    icon: "settings",
  },
  {
    id: "instance",
    title: "Instance",
    description: "Server status, storage, backups, email, push relay and licensing.",
    icon: "key",
  },
];

export function settingsGroupLabel(id: SettingsGroupId): string {
  return SETTINGS_GROUPS.find((group) => group.id === id)?.title ?? "Settings";
}

/**
 * The Settings tab's hub: a flat index of the settings surfaces this viewer can
 * reach. Workspace details, branding and joining live on one page; operator
 * concerns live on the Instance page. There is no nested storage/overview/access
 * duplication.
 */
export function SettingsHub({
  canManageWorkspace,
  isInstanceAdmin = false,
  page = null,
  onNavigate,
}: SettingsHubProps) {
  const updates = useWorkspaceUpdates();
  const navigate = onNavigate ?? (() => undefined);
  const group = page?.group ?? null;
  const groups = isInstanceAdmin
    ? SETTINGS_GROUPS
    : SETTINGS_GROUPS.filter((entry) => entry.id !== "instance");

  if (group === "workspace") {
    return (
      <div className="flex flex-col gap-6" data-testid="settings-workspace">
        <WorkspaceBranding canManageWorkspace={canManageWorkspace} />
        <WorkspaceSettings canManageWorkspace={canManageWorkspace} />
      </div>
    );
  }
  if (group === "addons") return <AddonsSettings canManageWorkspace={canManageWorkspace} />;
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
              <span className="block text-[13px] font-medium text-text">
                {entry.title}
                {entry.id === "instance" && updates.available && (
                  <span
                    className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-accent"
                    role="img"
                    aria-label="Workspace update available"
                  />
                )}
              </span>
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
