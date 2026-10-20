import { Button, Card, Text } from "@aulora/ui-web";
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
import { SettingsSectionHeader } from "../SettingsSection";
import { UpdatesCard } from "./UpdatesCard";

export type Overview = FunctionReturnType<typeof api.instance.overview>;

/** At-a-glance server status: version, counts, storage, license and backups. */
export function OverviewSection({ overview }: { readonly overview: Overview }) {
  return (
    <div className="flex flex-col gap-4" data-testid="instance-overview">
      <SettingsSectionHeader
        icon="shield"
        title={overview.name}
        description={`Aulora v${overview.version} · API v${overview.apiVersion}`}
      />
      <UpdatesCard />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <Stat label="Members" value={String(overview.counts.members)} />
        <Stat label="Channels" value={String(overview.counts.channels)} />
        <Stat label="Devices" value={String(overview.counts.devices)} />
        <Stat label="Files" value={String(overview.counts.files)} />
      </dl>
      <Card className="flex flex-col gap-1">
        <Text size="sm">Storage used: {formatBytes(overview.storage.usedBytes)}</Text>
        <Text size="sm" tone="muted">
          Quota: {formatQuota(overview.storage.quotaBytes)} · Max upload:{" "}
          {formatBytes(overview.storage.maxUploadBytes)}
        </Text>
      </Card>
      <Card className="flex flex-col gap-1">
        <Text size="sm">
          License: <span className="uppercase">{overview.license.state}</span>
        </Text>
        <Text size="sm" tone="muted">
          {overview.license.note}
        </Text>
      </Card>
      <Card className="flex flex-col gap-1">
        <Text size="sm">Backups: {overview.backups.enabled ? "enabled" : "disabled"}</Text>
        <Text size="sm" tone="muted">
          {overview.backups.lastRun === null
            ? "No runs recorded yet."
            : `Last run ${backupStatusLabel(overview.backups.lastRun.status)} at ${formatTimestamp(overview.backups.lastRun.startedAt)}.`}
        </Text>
      </Card>
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
    <div className="flex flex-col gap-4" data-testid="instance-backups">
      <SettingsSectionHeader
        icon="history"
        title="Backups"
        description="The Convex cron records a nightly intent at 03:00 UTC. The backup runner exports Convex and dumps Postgres to S3, then reports back here."
      />
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
      <ul className="flex flex-col gap-1" data-testid="instance-backup-list">
        {(backups ?? []).map((entry) => (
          <li
            key={entry.id}
            className="flex items-center justify-between rounded-input border border-border bg-surface-2 px-3 py-2"
          >
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
          <Text tone="muted" size="sm">
            No backup runs yet.
          </Text>
        )}
      </ul>
    </div>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col rounded-input border border-border bg-surface-2 px-3 py-2">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="text-md text-text">{value}</dd>
    </div>
  );
}
