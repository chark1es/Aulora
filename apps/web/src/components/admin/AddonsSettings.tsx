import { Spinner, Switch, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { SettingsSectionHeader } from "./SettingsSection";

export function AddonsSettings({ canManageWorkspace }: { canManageWorkspace: boolean }) {
  const config = useQuery(api.server.settings, canManageWorkspace ? {} : "skip");
  const setEnabled = useMutation(api.kanban.setEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      <div className="rounded-[14px] border border-border bg-surface-2 px-4 py-3">
        <Switch
          checked={config.settings.kanbanEnabled ?? false}
          disabled={busy}
          label="Kanban"
          description="Plan work on shared or private boards with cards, comments, attachments, timers and GitHub links. Off by default."
          onChange={(enabled) => {
            setBusy(true);
            setError(null);
            void setEnabled({ enabled })
              .catch((cause: unknown) =>
                setError(
                  cause instanceof Error ? cause.message : "Could not change Kanban. Try again.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        />
      </div>
      <Text size="sm" tone="muted">
        Grant View Kanban, Edit Kanban, Comment on Kanban and Manage Kanban permissions in Roles.
        Existing roles keep their permissions. Board managers can access all private boards.
      </Text>
      <Text size="sm" tone="muted">
        Turning Kanban off stops work timers and keeps your boards, cards and files for when you
        enable it again.
      </Text>
      {error && (
        <Text role="alert" tone="danger">
          {error}
        </Text>
      )}
    </div>
  );
}
