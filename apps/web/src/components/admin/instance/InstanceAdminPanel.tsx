import { Button, Card, Heading, Icon, IconButton, Input, Switch, Text } from "@aulora/ui-web";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import {
  backupStatusLabel,
  backupStatusTone,
  formatBytes,
  formatQuota,
  formatTimestamp,
  parseByteInput,
} from "../../../lib/instance-admin";
import { SettingsSectionHeader } from "../SettingsSection";
import { LicensePanel } from "./LicensePanel";

export interface InstanceAdminPanelProps {
  readonly canManage: boolean;
  /** Only used by the overlay variant's Close affordance. */
  readonly onClose?: () => void;
  /** `overlay` renders the fixed dialog; `inline` embeds in a settings page. */
  readonly variant?: "overlay" | "inline";
}

type TabId = "overview" | "auth" | "email" | "storage" | "backups" | "push" | "license";

const TABS: readonly { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "auth", label: "Auth providers" },
  { id: "email", label: "Email" },
  { id: "storage", label: "Storage" },
  { id: "backups", label: "Backups" },
  { id: "push", label: "Push relay" },
  { id: "license", label: "License" },
];

/**
 * Instance admin console for the operator: auth provider status, storage
 * quotas, backups and push relay settings, plus the license status. Every write
 * is re-checked server-side against the workspace owner.
 *
 * Renders as the classic right-side overlay by default, or inline (the new
 * home inside workspace settings) when `variant="inline"`.
 */
export function InstanceAdminPanel({
  canManage,
  onClose,
  variant = "overlay",
}: InstanceAdminPanelProps) {
  if (variant === "inline") {
    return (
      <section
        className="flex flex-col gap-5"
        data-testid="instance-admin-panel"
        aria-label="Instance admin"
      >
        <SettingsSectionHeader
          icon="shield"
          title="Instance"
          description="Server status, storage quotas, backups, push relay and licensing. Visible to the workspace owner only."
        />
        <InstanceAdminContent canManage={canManage} bodyClassName="flex flex-col gap-4" />
      </section>
    );
  }

  return (
    <div
      className="fixed inset-0 z-30 flex justify-end bg-bg/70"
      data-testid="instance-admin-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Instance admin"
    >
      <div className="flex h-full w-full max-w-3xl flex-col border-l border-border bg-surface-1">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <Heading level={2}>Instance admin</Heading>
          <IconButton label="Close instance admin" onClick={() => onClose?.()}>
            <Icon name="x" size={16} />
          </IconButton>
        </header>
        <InstanceAdminContent
          canManage={canManage}
          {...(onClose !== undefined ? { onClose } : {})}
          bodyClassName="min-h-0 flex-1 overflow-y-auto p-5"
        />
      </div>
    </div>
  );
}

function InstanceAdminContent({
  canManage,
  onClose,
  bodyClassName,
}: {
  readonly canManage: boolean;
  readonly onClose?: () => void;
  readonly bodyClassName: string;
}) {
  const overview = useQuery(api.instance.overview, canManage ? {} : "skip");
  const [active, setActive] = useState<TabId>("overview");

  return (
    <>
      <nav
        className="flex flex-wrap gap-1 border-b border-border px-4 py-2"
        aria-label="Instance admin sections"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-current={active === tab.id ? "page" : undefined}
            className={
              active === tab.id
                ? "rounded-[7px] bg-surface-3 px-3 py-1 text-[13px] font-medium text-text"
                : "rounded-[7px] px-3 py-1 text-[13px] text-text-muted hover:bg-surface-2 hover:text-text"
            }
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className={bodyClassName}>
        {!canManage ? (
          <Text tone="muted" size="sm" data-testid="instance-admin-locked">
            Only the instance administrator can open this panel.
          </Text>
        ) : overview === undefined ? (
          <Text tone="muted" size="sm">
            Loading instance status…
          </Text>
        ) : (
          <>
            {active === "overview" && <OverviewSection overview={overview} />}
            {active === "auth" && <AuthSection overview={overview} />}
            {active === "email" && <EmailSection overview={overview} />}
            {active === "storage" && <StorageSection overview={overview} />}
            {active === "backups" && <BackupsSection overview={overview} />}
            {active === "push" && <PushRelaySection overview={overview} />}
            {active === "license" && <LicensePanel canManage={canManage} />}
          </>
        )}
        {onClose !== undefined && (
          <div className="mt-6">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

type Overview = FunctionReturnType<typeof api.instance.overview>;

function OverviewSection({ overview }: { overview: Overview }) {
  return (
    <div className="flex flex-col gap-4" data-testid="instance-overview">
      <Heading level={3}>{overview.name}</Heading>
      <Text tone="muted" size="sm" mono>
        Aulora v{overview.version} · API v{overview.apiVersion}
      </Text>
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

function AuthSection({ overview }: { overview: Overview }) {
  const updateAuthProviders = useMutation(api.instance.updateAuthProviders);
  const stored = (overview.auth.providersConfigured ?? {}) as Record<string, boolean | undefined>;
  const [toggles, setToggles] = useState<Record<string, boolean | undefined>>(stored);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const providers = {
        ...(toggles.github !== undefined ? { github: toggles.github } : {}),
        ...(toggles.google !== undefined ? { google: toggles.google } : {}),
        ...(toggles.microsoft !== undefined ? { microsoft: toggles.microsoft } : {}),
        ...(toggles.apple !== undefined ? { apple: toggles.apple } : {}),
        ...(toggles.oidc !== undefined ? { oidc: toggles.oidc } : {}),
      };
      await updateAuthProviders({ providers });
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save providers.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="instance-auth">
      <Heading level={3}>Auth providers</Heading>
      <Text tone="muted" size="sm">
        Credentials come from the deployment environment; a provider is offered only when it is both
        configured and switched on here.
      </Text>
      <Card className="flex flex-col gap-1">
        <Text size="sm">
          Local email/password: {overview.auth.local.enabled ? "enabled" : "disabled"} · signup{" "}
          {overview.auth.local.signup ? "open" : "closed"}
        </Text>
      </Card>
      <ul className="flex flex-col gap-1" data-testid="instance-auth-providers">
        {overview.auth.availableProviders.map((provider) => {
          const enabled = toggles[provider.id] ?? provider.enabled;
          return (
            <li
              key={provider.id}
              className="rounded-input border border-border bg-surface-2 px-3 py-2"
            >
              <Switch
                checked={enabled}
                disabled={!provider.configured}
                onChange={(value) => {
                  setToggles((current) => ({ ...current, [provider.id]: value }));
                  setSaved(false);
                }}
                label={provider.displayName}
                {...(provider.configured
                  ? {}
                  : {
                      description:
                        "Not configured — set credentials in the deployment environment.",
                    })}
              />
            </li>
          );
        })}
      </ul>
      {overview.auth.oidc !== null && (
        <Card className="flex flex-col gap-1">
          <Text size="sm">OIDC: {overview.auth.oidc.displayName}</Text>
          <Text size="xs" tone="muted" mono>
            {overview.auth.oidc.discoveryUrl}
          </Text>
          <Text size="xs" tone="muted">
            scopes: {overview.auth.oidc.scopes.join(" ")}
          </Text>
        </Card>
      )}
      <div className="flex items-center gap-3">
        <Button loading={busy} disabled={busy} onClick={() => void save()}>
          Save providers
        </Button>
        {saved && (
          <Text tone="secondary" size="sm" role="status">
            Saved.
          </Text>
        )}
        {error !== null && (
          <Text tone="danger" size="sm" role="alert">
            {error}
          </Text>
        )}
      </div>
    </div>
  );
}

interface EmailStatus {
  readonly provider?: string;
  readonly from?: string;
  readonly configured?: boolean;
}

function EmailSection({ overview }: { overview: Overview }) {
  const sendTest = useAction(api.email.sendTest);
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const email = (overview as { email?: EmailStatus }).email ?? {};
  const provider = email.provider ?? "environment";
  const from = email.from ?? "AULORA_EMAIL_FROM";

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="instance-email"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setStatus(null);
        setBusy(true);
        void sendTest({ to: to.trim() })
          .then((result) => {
            const sent = (result as { sent?: boolean }).sent;
            setStatus(
              sent === true ? "Test email sent." : "Email is not configured; nothing was sent.",
            );
          })
          .catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : "Could not send the test email."),
          )
          .finally(() => setBusy(false));
      }}
    >
      <Heading level={3}>Email</Heading>
      <Text tone="muted" size="sm">
        Invites and notifications are delivered through Resend or an SMTP HTTP gateway. Credentials
        live only in the deployment environment.
      </Text>
      <Card className="flex flex-col gap-1">
        <Text size="sm">
          Provider: <span className="uppercase">{provider}</span>
        </Text>
        <Text size="sm" tone="muted">
          From: {from}
        </Text>
      </Card>
      <Input
        label="Send a test email to"
        type="email"
        placeholder="you@example.com"
        value={to}
        onChange={(event) => setTo(event.currentTarget.value)}
        autoComplete="off"
      />
      {status !== null && (
        <Text tone="secondary" size="sm" role="status">
          {status}
        </Text>
      )}
      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}
      <div>
        <Button type="submit" loading={busy} disabled={busy || to.trim().length === 0}>
          Send test email
        </Button>
      </div>
    </form>
  );
}

function StorageSection({ overview }: { overview: Overview }) {
  const updateStorage = useMutation(api.instance.updateStorage);
  const [quota, setQuota] = useState("");
  const [maxUpload, setMaxUpload] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setQuota(overview.storage.quotaBytes > 0 ? String(overview.storage.quotaBytes) : "0");
    setMaxUpload(String(overview.storage.maxUploadBytes));
  }, [overview.storage.quotaBytes, overview.storage.maxUploadBytes]);

  const parseQuota = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed === "0") {
      return 0;
    }
    return parseByteInput(trimmed);
  };

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="instance-storage"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setSaved(false);
        const quotaBytes = parseQuota(quota);
        const maxUploadBytes = parseByteInput(maxUpload);
        if (quotaBytes === null || maxUploadBytes === null) {
          setError("Enter a valid size such as 25 MiB, 1 GiB, or 0 for unlimited.");
          return;
        }
        setBusy(true);
        void updateStorage({ storageQuotaBytes: quotaBytes, maxUploadBytes })
          .then(() => setSaved(true))
          .catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : "Could not save the quota."),
          )
          .finally(() => setBusy(false));
      }}
    >
      <Heading level={3}>Storage quotas</Heading>
      <Text tone="muted" size="sm">
        The quota is the total upload budget; 0 means unlimited. The max upload caps a single file.
      </Text>
      <Input
        label="Total storage quota"
        hint="Examples: 50 GiB, 500 MiB, 0 for unlimited."
        value={quota}
        onChange={(event) => setQuota(event.currentTarget.value)}
      />
      <Input
        label="Max upload size"
        hint="Examples: 25 MiB, 100 MiB."
        value={maxUpload}
        onChange={(event) => setMaxUpload(event.currentTarget.value)}
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

function BackupsSection({ overview }: { overview: Overview }) {
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
          onClick={() => void run(() => updateBackups({ enabled: !overview.backups.enabled }))}
        >
          {overview.backups.enabled ? "Disable nightly backups" : "Enable nightly backups"}
        </Button>
        <Button disabled={busy} onClick={() => void run(() => requestBackup({}))}>
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

function PushRelaySection({ overview }: { overview: Overview }) {
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
          .then(() => setSaved(true))
          .catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : "Could not save the relay."),
          )
          .finally(() => setBusy(false));
      }}
    >
      <Heading level={3}>Push relay</Heading>
      <Text tone="muted" size="sm">
        Optional relay for store-built mobile apps. The shared token stays in the deployment env
        (PUSH_RELAY_TOKEN); only its presence is shown.
      </Text>
      <Text size="sm" tone={overview.pushRelay.configured ? "secondary" : "muted"}>
        {overview.pushRelay.configured
          ? "Relay URL and token are set in the environment."
          : "Relay token is not set in the environment."}
      </Text>
      <div className="rounded-[10px] border border-border bg-surface-1 px-3.5">
        <Switch
          checked={enabled}
          onChange={setEnabled}
          label="Enable mobile push relay"
          description="Forward pushes for store-built mobile apps through the relay."
        />
      </div>
      <Input
        label="Relay URL"
        hint="Base URL the Convex action calls, e.g. https://relay.example.com."
        value={url}
        onChange={(event) => setUrl(event.currentTarget.value)}
        autoComplete="off"
        spellCheck={false}
      />
      <Input
        label="Server id"
        hint="Opaque id echoed in wakeups; defaults to the site URL."
        value={serverId}
        onChange={(event) => setServerId(event.currentTarget.value)}
        autoComplete="off"
        spellCheck={false}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-input border border-border bg-surface-2 px-3 py-2">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="text-md text-text">{value}</dd>
    </div>
  );
}
