import { Spinner, Switch, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { SettingsSectionHeader } from "./SettingsSection";

interface AddonToggleProps {
  label: string;
  description: string;
  checked: boolean;
  // eslint-disable-next-line no-unused-vars -- base rule treats TypeScript callback parameters as variables
  onToggle: (enabled: boolean) => Promise<unknown>;
  failureMessage: string;
}

/** One addon switch, with its own in-flight and error state. */
function AddonToggle({ label, description, checked, onToggle, failureMessage }: AddonToggleProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="rounded-[14px] border border-border bg-surface-2 px-4 py-3">
      <Switch
        checked={checked}
        disabled={busy}
        label={label}
        description={description}
        onChange={(enabled) => {
          setBusy(true);
          setError(null);
          void onToggle(enabled)
            .catch((cause: unknown) => {
              setError(cause instanceof Error ? cause.message : failureMessage);
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      />
      {error !== null && (
        <Text role="alert" tone="danger" size="sm" className="mt-2">
          {error}
        </Text>
      )}
    </div>
  );
}

export function AddonsSettings({ canManageWorkspace }: { canManageWorkspace: boolean }) {
  const config = useQuery(api.server.settings, canManageWorkspace ? {} : "skip");
  const setKanbanEnabled = useMutation(api.kanban.setEnabled);
  const setNotesEnabled = useMutation(api.workspaceNotes.setEnabled);
  if (!canManageWorkspace)
    return <Text tone="muted">You need Manage workspace permission to change addons.</Text>;
  if (!config) return <Spinner label="Loading addons" />;
  return (
    <div className="flex flex-col gap-5" data-testid="settings-addons">
      <SettingsSectionHeader
        icon="settings"
        title="Addons"
        description="Choose which tools are available in this workspace."
      />
      <AddonToggle
        label="Kanban"
        description="Plan work on shared or private boards with cards, comments, attachments, timers and GitHub links. Off by default."
        checked={config.settings.kanbanEnabled ?? false}
        onToggle={(enabled) => setKanbanEnabled({ enabled })}
        failureMessage="Could not change Kanban. Try again."
      />
      <AddonToggle
        label="Notes"
        description="Shared Markdown notes with folders, tags, permissions and history. Off by default."
        checked={config.settings.notesEnabled ?? false}
        onToggle={(enabled) => setNotesEnabled({ enabled })}
        failureMessage="Could not change Notes. Try again."
      />
      <Text size="sm" tone="muted">
        Grant View Kanban, Edit Kanban, Comment on Kanban and Manage Kanban permissions in Roles.
        Existing roles keep their permissions. Board managers can access all private boards.
      </Text>
      <Text size="sm" tone="muted">
        Grant View Notes, Create Notes, Edit Notes, Delete Notes and Manage Notes permissions in
        Roles. Existing roles keep their permissions.
      </Text>
      <Text size="sm" tone="muted">
        Turning an addon off keeps its data for when you enable it again. Turning Kanban off stops
        work timers.
      </Text>
    </div>
  );
}
