import { Spinner, Switch, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { AdminPageHeader } from "./AdminPageHeader";
import { SettingsGroup, SettingsGroupRow } from "./SettingsGroup";

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
    <SettingsGroupRow label={label} description={description}>
      <Switch
        bare
        checked={checked}
        disabled={busy}
        label={label}
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
        <Text role="alert" tone="danger" size="sm" className="max-w-[220px] text-right">
          {error}
        </Text>
      )}
    </SettingsGroupRow>
  );
}

/** What enabling an addon does to permissions and data, under the toggles. */
function AddonNotes() {
  return (
    <div className="flex flex-col gap-2 text-[12px] leading-relaxed text-text-muted">
      <p>
        Grant View Kanban, Edit Kanban, Comment on Kanban and Manage Kanban permissions in Roles.
        Existing roles keep their permissions. Board managers can access all private boards.
      </p>
      <p>
        Grant View Notes, Create Notes, Edit Notes, Delete Notes and Manage Notes permissions in
        Roles. Existing roles keep their permissions.
      </p>
      <p>
        Turning an addon off keeps its data for when you enable it again. Turning Kanban off stops
        work timers.
      </p>
    </div>
  );
}

export function AddonsSettings({ canManageWorkspace }: { canManageWorkspace: boolean }) {
  const config = useQuery(api.server.settings, canManageWorkspace ? {} : "skip");
  const setKanbanEnabled = useMutation(api.kanban.setEnabled);
  const setNotesEnabled = useMutation(api.workspaceNotes.setEnabled);
  if (!canManageWorkspace) {
    return (
      <div data-testid="settings-addons">
        <AdminPageHeader
          title="Addons"
          description="Choose which optional tools are available in this workspace."
        />
        <Text tone="muted">You need Manage workspace permission to change addons.</Text>
      </div>
    );
  }
  if (!config) {
    return <Spinner label="Loading addons" />;
  }
  return (
    <div className="flex flex-col gap-8" data-testid="settings-addons">
      <AdminPageHeader
        title="Addons"
        description="Choose which optional tools are available in this workspace."
      />

      <div className="flex flex-col gap-4">
        <SettingsGroup title="Tools">
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
        </SettingsGroup>

        <AddonNotes />
      </div>
    </div>
  );
}
