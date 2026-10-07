import { Button, Card, Heading, Input, Select, Switch, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import {
  BYTE_UNIT_OPTIONS,
  type ByteUnit,
  backupStatusLabel,
  backupStatusTone,
  composeByteSize,
  formatBytes,
  formatQuota,
  formatTimestamp,
  splitByteSize,
} from "../../../lib/instance-admin";
import type { Callback } from "../callbacks";
import { UpdatesCard } from "./UpdatesCard";

export type Overview = FunctionReturnType<typeof api.instance.overview>;

type AuthProvider = Overview["auth"]["availableProviders"][number];

export function OverviewSection({ overview }: { readonly overview: Overview }) {
  return (
    <div className="flex flex-col gap-4" data-testid="instance-overview">
      <Heading level={3}>{overview.name}</Heading>
      <Text tone="muted" size="sm" mono>
        Aulora v{overview.version} · API v{overview.apiVersion}
      </Text>
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

async function persistAuthProviders(
  update: (args: { providers: Record<string, boolean | undefined> }) => Promise<unknown>,
  toggles: Record<string, boolean | undefined>,
  setError: (value: string | null) => void,
  setSaved: (value: boolean) => void,
  setBusy: (value: boolean) => void,
): Promise<void> {
  setError(null);
  setSaved(false);
  setBusy(true);
  try {
    await update({ providers: providersPayload(toggles) });
    setSaved(true);
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : "Could not save providers.");
  } finally {
    setBusy(false);
  }
}

function providersPayload(
  toggles: Record<string, boolean | undefined>,
): Record<string, boolean | undefined> {
  return {
    ...(toggles.github !== undefined ? { github: toggles.github } : {}),
    ...(toggles.google !== undefined ? { google: toggles.google } : {}),
    ...(toggles.microsoft !== undefined ? { microsoft: toggles.microsoft } : {}),
    ...(toggles.apple !== undefined ? { apple: toggles.apple } : {}),
    ...(toggles.oidc !== undefined ? { oidc: toggles.oidc } : {}),
  };
}

function AuthProviderList({
  providers,
  toggles,
  onToggle,
}: {
  readonly providers: readonly AuthProvider[];
  readonly toggles: Record<string, boolean | undefined>;
  readonly onToggle: Callback<[providerId: string, value: boolean]>;
}) {
  return (
    <ul className="flex flex-col gap-1" data-testid="instance-auth-providers">
      {providers.map((provider) => (
        <AuthProviderToggle
          key={provider.id}
          provider={provider}
          enabled={toggles[provider.id] ?? provider.enabled}
          onToggle={(value) => {
            onToggle(provider.id, value);
          }}
        />
      ))}
    </ul>
  );
}

interface AuthSectionModel {
  readonly overview: Overview;
  readonly toggles: Record<string, boolean | undefined>;
  readonly saved: boolean;
  readonly error: string | null;
  readonly busy: boolean;
  readonly onToggle: Callback<[providerId: string, value: boolean]>;
  readonly onSave: () => void;
}

function useAuthSectionModel(overview: Overview): AuthSectionModel {
  const updateAuthProviders = useMutation(api.instance.updateAuthProviders);
  const stored = (overview.auth.providersConfigured ?? {}) as Record<string, boolean | undefined>;
  const [toggles, setToggles] = useState<Record<string, boolean | undefined>>(stored);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  return {
    overview,
    toggles,
    saved,
    error,
    busy,
    onToggle: (providerId, value) => {
      setToggles((current) => ({ ...current, [providerId]: value }));
      setSaved(false);
    },
    onSave: () => {
      void persistAuthProviders(updateAuthProviders, toggles, setError, setSaved, setBusy);
    },
  };
}

export function AuthSection({ overview }: { readonly overview: Overview }) {
  return <AuthSectionView model={useAuthSectionModel(overview)} />;
}

function AuthSectionView({ model }: { readonly model: AuthSectionModel }) {
  return (
    <div className="flex flex-col gap-4" data-testid="instance-auth">
      <Heading level={3}>Auth providers</Heading>
      <Text tone="muted" size="sm">
        Credentials come from the deployment environment; a provider is offered only when it is both
        configured and switched on here.
      </Text>
      <Card className="flex flex-col gap-1">
        <Text size="sm">
          Local email/password: {model.overview.auth.local.enabled ? "enabled" : "disabled"} ·
          signup {model.overview.auth.local.signup ? "open" : "closed"}
        </Text>
      </Card>
      <AuthProviderList
        providers={model.overview.auth.availableProviders}
        toggles={model.toggles}
        onToggle={model.onToggle}
      />
      {model.overview.auth.oidc !== null && (
        <Card className="flex flex-col gap-1">
          <Text size="sm">OIDC: {model.overview.auth.oidc.displayName}</Text>
          <Text size="xs" tone="muted" mono>
            {model.overview.auth.oidc.discoveryUrl}
          </Text>
          <Text size="xs" tone="muted">
            scopes: {model.overview.auth.oidc.scopes.join(" ")}
          </Text>
        </Card>
      )}
      <div className="flex items-center gap-3">
        <Button loading={model.busy} disabled={model.busy} onClick={model.onSave}>
          Save providers
        </Button>
        {model.saved && (
          <Text tone="secondary" size="sm" role="status">
            Saved.
          </Text>
        )}
        {model.error !== null && (
          <Text tone="danger" size="sm" role="alert">
            {model.error}
          </Text>
        )}
      </div>
    </div>
  );
}

function AuthProviderToggle({
  provider,
  enabled,
  onToggle,
}: {
  readonly provider: AuthProvider;
  readonly enabled: boolean;
  readonly onToggle: Callback<[value: boolean]>;
}) {
  return (
    <li className="rounded-input border border-border bg-surface-2 px-3 py-2">
      <Switch
        checked={enabled}
        disabled={!provider.configured}
        onChange={onToggle}
        label={provider.displayName}
        {...(provider.configured
          ? {}
          : {
              description: "Not configured — set credentials in the deployment environment.",
            })}
      />
    </li>
  );
}

interface ByteSizeDraft {
  readonly value: string;
  readonly unit: ByteUnit;
}

const MIN_MAX_UPLOAD_BYTES = 1024;

export function StorageSection({ overview }: { readonly overview: Overview }) {
  const updateStorage = useMutation(api.instance.updateStorage);
  const [quota, setQuota] = useState<ByteSizeDraft>({ value: "0", unit: "GiB" });
  const [maxUpload, setMaxUpload] = useState<ByteSizeDraft>({ value: "", unit: "MiB" });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setQuota(splitByteSize(overview.storage.quotaBytes));
    setMaxUpload(splitByteSize(overview.storage.maxUploadBytes));
  }, [overview.storage.quotaBytes, overview.storage.maxUploadBytes]);

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="instance-storage"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setSaved(false);
        const quotaBytes = quota.value.trim() === "" ? 0 : composeByteSize(quota.value, quota.unit);
        const maxUploadBytes = composeByteSize(maxUpload.value, maxUpload.unit);
        if (quotaBytes === null || maxUploadBytes === null) {
          setError("Enter a number for the quota and the max upload size.");
          return;
        }
        if (
          maxUploadBytes < MIN_MAX_UPLOAD_BYTES ||
          (quotaBytes > 0 && maxUploadBytes > quotaBytes)
        ) {
          setError("Max upload must be at least 1 KiB and no larger than the quota.");
          return;
        }
        setBusy(true);
        void updateStorage({ storageQuotaBytes: quotaBytes, maxUploadBytes })
          .then(() => {
            setSaved(true);
          })
          .catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : "Could not save the quota.");
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <Heading level={3}>Storage quotas</Heading>
      <Text tone="muted" size="sm">
        The quota is the total upload budget; 0 means unlimited. The max upload caps a single file.
        Type a number and choose its binary unit.
      </Text>
      <ByteSizeField
        label="Total storage quota"
        hint="0 means unlimited. Enter a number and pick a unit."
        draft={quota}
        onChange={setQuota}
      />
      <ByteSizeField
        label="Max upload size"
        hint="At least 1 KiB and no larger than the quota."
        draft={maxUpload}
        onChange={setMaxUpload}
      />
      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}
      {saved && (
        <Text tone="secondary" size="sm" role="status">
          Quota saved.
        </Text>
      )}
      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          Save quotas
        </Button>
      </div>
    </form>
  );
}

function ByteSizeField({
  label,
  hint,
  draft,
  onChange,
}: {
  readonly label: string;
  readonly hint: string;
  readonly draft: ByteSizeDraft;
  readonly onChange: (draft: ByteSizeDraft) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <Input
          label={label}
          hint={hint}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={draft.value}
          onChange={(event) => {
            onChange({ ...draft, value: event.currentTarget.value });
          }}
        />
      </div>
      <Select
        label="Unit"
        className="w-24 shrink-0"
        value={draft.unit}
        options={BYTE_UNIT_OPTIONS}
        onChange={(unit) => {
          onChange({ ...draft, unit });
        }}
      />
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
      <Heading level={3}>Backups</Heading>
      <Text tone="muted" size="sm">
        The Convex cron records a nightly intent at 03:00 UTC. The backup runner exports Convex and
        dumps Postgres to S3, then reports back here.
      </Text>
      <Text size="sm" tone={overview.backups.runnerConfigured ? "secondary" : "danger"}>
        {overview.backups.runnerConfigured
          ? "Backup runner token is configured."
          : "No BACKUP_TOKEN set: the runner cannot record results yet."}
      </Text>
      <div className="flex flex-wrap gap-2">
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
        {(backups ?? []).map((run) => (
          <li
            key={run.id}
            className="flex items-center justify-between rounded-input border border-border bg-surface-2 px-3 py-2"
          >
            <div className="flex flex-col">
              <Text size="sm" tone={backupStatusTone(run.status)} mono>
                {backupStatusLabel(run.status)} · {run.trigger}
              </Text>
              <Text size="xs" tone="muted">
                {formatTimestamp(run.startedAt)}
                {run.sizeBytes !== null ? ` · ${formatBytes(run.sizeBytes)}` : ""}
                {run.location !== null ? ` · ${run.location}` : ""}
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

export function PushRelaySection({ overview }: { readonly overview: Overview }) {
  const updatePushRelay = useMutation(api.instance.updatePushRelay);
  const [enabled, setEnabled] = useState(overview.pushRelay.enabled);
  const [url, setUrl] = useState(overview.pushRelay.url ?? "");
  const [serverId, setServerId] = useState(overview.pushRelay.serverId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEnabled(overview.pushRelay.enabled);
    setUrl(overview.pushRelay.url ?? "");
    setServerId(overview.pushRelay.serverId ?? "");
  }, [overview.pushRelay.enabled, overview.pushRelay.url, overview.pushRelay.serverId]);

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="instance-push"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setSaved(false);
        setBusy(true);
        void updatePushRelay({
          enabled,
          url: url.trim().length > 0 ? url.trim() : null,
          serverId: serverId.trim().length > 0 ? serverId.trim() : null,
        })
          .then(() => {
            setSaved(true);
          })
          .catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : "Could not save the relay.");
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <Heading level={3}>Push relay</Heading>
      <RelayStatus configured={overview.pushRelay.configured} />
      <div className="rounded-[10px] border border-border bg-surface-1 px-3.5">
        <Switch
          checked={enabled}
          onChange={setEnabled}
          label="Enable mobile push relay"
          description="Forward pushes for store-built mobile apps through the relay."
        />
      </div>
      <RelayIdentityFields
        url={url}
        serverId={serverId}
        onUrlChange={setUrl}
        onServerIdChange={setServerId}
      />
      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}
      {saved && (
        <Text tone="secondary" size="sm" role="status">
          Relay settings saved.
        </Text>
      )}
      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          Save relay settings
        </Button>
      </div>
    </form>
  );
}

function RelayStatus({ configured }: { readonly configured: boolean }) {
  return (
    <>
      <Text tone="muted" size="sm">
        Optional relay for store-built mobile apps. The shared token stays in the deployment env
        (PUSH_RELAY_TOKEN); only its presence is shown.
      </Text>
      <Text size="sm" tone={configured ? "secondary" : "muted"}>
        {configured
          ? "Relay URL and token are set in the environment."
          : "Relay token is not set in the environment."}
      </Text>
    </>
  );
}

function RelayIdentityFields({
  url,
  serverId,
  onUrlChange,
  onServerIdChange,
}: {
  readonly url: string;
  readonly serverId: string;
  readonly onUrlChange: Callback<[value: string]>;
  readonly onServerIdChange: Callback<[value: string]>;
}) {
  return (
    <>
      <Input
        label="Relay URL"
        hint="Base URL the Convex action calls, e.g. https://relay.example.com."
        value={url}
        onChange={(event) => {
          onUrlChange(event.currentTarget.value);
        }}
        autoComplete="off"
        spellCheck={false}
      />
      <Input
        label="Server id"
        hint="Opaque id echoed in wakeups; defaults to the site URL."
        value={serverId}
        onChange={(event) => {
          onServerIdChange(event.currentTarget.value);
        }}
        autoComplete="off"
        spellCheck={false}
      />
    </>
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
