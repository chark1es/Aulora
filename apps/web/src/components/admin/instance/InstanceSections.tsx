import { Button, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import {
  backupStatusLabel,
  backupStatusTone,
  formatBytes,
  formatQuota,
  formatTimestamp,
} from "../../../lib/instance-admin";
import { SettingsGroup, SettingsGroupRow } from "../SettingsGroup";
import { SettingsSection } from "../SettingsSection";
import { UpdatesCard } from "./UpdatesCard";

export type Overview = FunctionReturnType<typeof api.instance.overview>;

/** At-a-glance server status: version, counts, storage, license and backups. */
export function OverviewSection({ overview }: { readonly overview: Overview }) {
  const lastRun = overview.backups.lastRun;
  return (
    <div className="flex flex-col gap-6" data-testid="instance-overview">
      <UpdatesCard />
      <SettingsGroup>
        <SettingsGroupRow label="Server" description={`Aulora v${overview.version}`}>
          <span className="text-[13px] text-text">API v{overview.apiVersion}</span>
        </SettingsGroupRow>
        <SettingsGroupRow label="Members" description="People and bots in this workspace.">
          <span className="text-[13px] tabular-nums text-text">{overview.counts.members}</span>
        </SettingsGroupRow>
        <SettingsGroupRow label="Channels">
          <span className="text-[13px] tabular-nums text-text">{overview.counts.channels}</span>
        </SettingsGroupRow>
        <SettingsGroupRow label="Devices">
          <span className="text-[13px] tabular-nums text-text">{overview.counts.devices}</span>
        </SettingsGroupRow>
        <SettingsGroupRow label="Files">
          <span className="text-[13px] tabular-nums text-text">{overview.counts.files}</span>
        </SettingsGroupRow>
        <SettingsGroupRow
          label="Storage used"
          description={`Quota ${formatQuota(overview.storage.quotaBytes)} · max upload ${formatBytes(overview.storage.maxUploadBytes)}`}
        >
          <span className="text-[13px] tabular-nums text-text">
            {formatBytes(overview.storage.usedBytes)}
          </span>
        </SettingsGroupRow>
        <SettingsGroupRow label="License" description={overview.license.note}>
          <span className="text-[13px] capitalize text-text">{overview.license.state}</span>
        </SettingsGroupRow>
        <SettingsGroupRow
          label="Backups"
          description={
            lastRun === null
              ? "No runs recorded yet."
              : `Last run ${backupStatusLabel(lastRun.status)} at ${formatTimestamp(lastRun.startedAt)}.`
          }
        >
          <span className="text-[13px] text-text">
            {overview.backups.enabled ? "Enabled" : "Disabled"}
          </span>
        </SettingsGroupRow>
      </SettingsGroup>
    </div>
  );
}

export function BackupsSection({ overview }: { readonly overview: Overview }) {
  const backups = useQuery(api.backups.list, {});
  const updateBackups = useMutation(api.instance.updateBackups);
  const requestBackup = useMutation(api.backups.request);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(task: () => Promise<unknown>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8" data-testid="instance-backups">
      <SettingsSection
        title="Backups"
        description="The Convex cron records a nightly intent at 03:00 UTC. The backup runner exports Convex and dumps Postgres to S3, then reports back here."
      >
        <Text size="sm" tone={overview.backups.runnerConfigured ? "secondary" : "danger"}>
          {overview.backups.runnerConfigured
            ? "Backup runner token is configured."
            : "No BACKUP_TOKEN set: the runner cannot record results yet."}
        </Text>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              void run(() => updateBackups({ enabled: !overview.backups.enabled }));
            }}
          >
            {overview.backups.enabled ? "Disable nightly backups" : "Enable nightly backups"}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              void run(() => requestBackup({}));
            }}
          >
            Request backup now
          </Button>
        </div>
        {error !== null && (
          <Text tone="danger" size="sm" role="alert">
            {error}
          </Text>
        )}
        <ul
          className="divide-y divide-border/60 overflow-hidden rounded-[12px] bg-surface-2"
          data-testid="instance-backup-list"
        >
          {(backups ?? []).map((entry) => (
            <li key={entry.id} className="flex min-h-[44px] items-center px-4 py-2.5">
              <div className="flex flex-col">
                <Text size="sm" tone={backupStatusTone(entry.status)} mono>
                  {backupStatusLabel(entry.status)} · {entry.trigger}
                </Text>
                <Text size="xs" tone="muted">
                  {formatTimestamp(entry.startedAt)}
                  {entry.sizeBytes !== null ? ` · ${formatBytes(entry.sizeBytes)}` : ""}
                  {entry.location !== null ? ` · ${entry.location}` : ""}
                </Text>
              </div>
            </li>
          ))}
          {backups !== undefined && backups.length === 0 && (
            <li className="px-4 py-5 text-center">
              <Text tone="muted" size="sm">
                No backup runs yet.
              </Text>
            </li>
          )}
        </ul>
      </SettingsSection>
    </div>
  );
}
