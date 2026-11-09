import { Spinner, Switch, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { AdminPageHeader } from "./AdminPageHeader";
import { SettingsGroup, SettingsGroupRow } from "./SettingsGroup";
import { TranscriptionSettings } from "./TranscriptionSettings";

interface AddonToggleProps {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  // eslint-disable-next-line no-unused-vars -- base rule treats TypeScript callback parameters as variables
  onToggle: (enabled: boolean) => Promise<unknown>;
  failureMessage: string;
}

/** One addon switch, with its own in-flight and error state. */
function AddonToggle({
  label,
  description,
  checked,
  disabled = false,
  onToggle,
  failureMessage,
}: AddonToggleProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <SettingsGroupRow label={label} description={description}>
      <Switch
        bare
        checked={checked}
        disabled={busy || disabled}
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
        Calls addons add permissions under Calls in Roles: Start transcription, View transcripts,
        Manage transcription, Create guest links, Manage guest access, Schedule calls, Manage
        scheduled calls and View scheduled calls. Only View scheduled calls is granted to everyone,
        once, when Scheduled calls first exists. Owners and administrators hold all of them.
      </p>
      <p>
        Turning an addon off keeps its data for when you enable it again. Turning Kanban off stops
        work timers.
      </p>
    </div>
  );
}

export function AddonsSettings({
  canManageWorkspace,
  canManageTranscription = false,
}: {
  canManageWorkspace: boolean;
  canManageTranscription?: boolean;
}) {
  const config = useQuery(api.server.settings, canManageWorkspace ? {} : "skip");
  const addons = useQuery(api.addons.status, {});
  const setKanbanEnabled = useMutation(api.kanban.setEnabled);
  const setNotesEnabled = useMutation(api.workspaceNotes.setEnabled);
  const setAddonEnabled = useMutation(api.addons.setEnabled);
  if (!canManageWorkspace && !canManageTranscription) {
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
  if (canManageWorkspace && !config) {
    return <Spinner label="Loading addons" />;
  }
  // The calls switches stay disabled until their state arrives, so the page never flickers.
  const loaded = addons !== undefined;
  const flags = {
    transcription: addons?.transcription ?? false,
    guestCalls: addons?.guestCalls ?? false,
    scheduledCalls: addons?.scheduledCalls ?? false,
  };
  return (
    <div className="flex flex-col gap-8" data-testid="settings-addons">
      <AdminPageHeader
        title="Addons"
        description="Choose which optional tools are available in this workspace."
      />

      {canManageWorkspace && config && (
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
          <SettingsGroup title="Calls">
            <AddonToggle
              label="Transcription"
              description="Speech-to-text for calls, with a summary written afterwards. Needs the optional transcriber service and a downloaded model. Everyone in a transcribed call sees a notice and can opt out of sending their own audio. Off by default."
              checked={flags.transcription}
              disabled={!loaded}
              onToggle={(enabled) => setAddonEnabled({ addon: "transcription", enabled })}
              failureMessage="Could not change Transcription. Try again."
            />
            <AddonToggle
              label="Guest calls"
              description="Let members invite people without an account to a call with a link. Guests wait in a lobby until someone admits them, and see nothing else in the workspace. Off by default."
              checked={flags.guestCalls}
              disabled={!loaded}
              onToggle={(enabled) => setAddonEnabled({ addon: "guestCalls", enabled })}
              failureMessage="Could not change Guest calls. Try again."
            />
            <AddonToggle
              label="Scheduled calls"
              description="A Scheduled tab for planning calls that open for joining shortly before they start. Off by default."
              checked={flags.scheduledCalls}
              disabled={!loaded}
              onToggle={(enabled) => setAddonEnabled({ addon: "scheduledCalls", enabled })}
              failureMessage="Could not change Scheduled calls. Try again."
            />
          </SettingsGroup>
          <AddonNotes />
        </div>
      )}

      {canManageTranscription && flags.transcription && <TranscriptionSettings />}
      {canManageTranscription && loaded && !flags.transcription && !canManageWorkspace && (
        <Text tone="muted">
          Transcription is switched off. Someone with Manage workspace permission can turn it on.
        </Text>
      )}
    </div>
  );
}
