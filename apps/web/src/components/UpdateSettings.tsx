/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, Card, cn, Text } from "@aulora/ui-web";
import { isDesktop } from "../lib/desktop";
import { type UpdatePhase, useDesktopUpdates } from "../providers/DesktopUpdateProvider";
import { ReleaseNotes } from "./ReleaseNotes";
import {
  downloadLabel,
  downloadPercent,
  formatCheckedAt,
  formatReleaseDate,
  type PrimaryAction,
  type PrimaryHandlers,
  primaryAction,
  resolvePrimary,
  statusText,
  type UpdateProgressLike,
  versionTransition,
} from "./updateViewModel";

export interface UpdateSettingsProps {
  readonly title: string;
  readonly currentVersion: string | null;
  readonly latestVersion: string | null;
  readonly releaseDate?: string | null;
  readonly available: boolean;
  readonly phase: UpdatePhase;
  readonly error: string | null;
  readonly notes?: string | null;
  readonly detail?: string | null;
  readonly canDownload?: boolean;
  readonly checked?: boolean;
  readonly lastCheckedAt?: number | null;
  readonly installDirectly?: boolean;
  readonly progress?: UpdateProgressLike | null;
  readonly onCheck: () => void;
  readonly onDownload: () => void;
  readonly onRestart: () => void;
}

interface UpdateView {
  readonly title: string;
  readonly badge: string | null;
  readonly currentVersion: string | null;
  readonly released: string | null;
  readonly status: string;
  readonly detail: string | null;
  readonly checkedAt: string | null;
  readonly showCheckedAt: boolean;
  readonly phase: UpdatePhase;
  readonly progress: UpdateProgressLike | null;
  readonly percent: number | null;
  readonly progressText: string | null;
  readonly notes: string | null;
  readonly error: string | null;
  readonly available: boolean;
  readonly canDownload: boolean;
  readonly installDirectly: boolean;
  readonly handlers: PrimaryHandlers;
}

function deriveUpdate(props: UpdateSettingsProps): UpdateView {
  const {
    title,
    currentVersion,
    latestVersion,
    releaseDate = null,
    available,
    phase,
    error,
    notes = null,
    detail = null,
    canDownload = true,
    checked = false,
    lastCheckedAt = null,
    installDirectly = false,
    progress = null,
    onCheck,
    onDownload,
    onRestart,
  } = props;
  const ready = phase === "ready";
  const checkedAt = formatCheckedAt(lastCheckedAt);
  return {
    title,
    badge: versionTransition(currentVersion, latestVersion),
    currentVersion,
    released: formatReleaseDate(releaseDate),
    status: statusText({ phase, available, ready, latestVersion, checked, installDirectly }),
    detail,
    checkedAt,
    showCheckedAt: checkedAt !== null && !available && phase === "idle" && error === null,
    phase,
    progress,
    percent: downloadPercent(progress),
    progressText: downloadLabel(progress),
    notes,
    error,
    available,
    canDownload,
    installDirectly,
    handlers: { check: onCheck, download: onDownload, restart: onRestart },
  };
}

/** The formatted update card shared by the desktop client and workspace instance. */
export function UpdateSettings(props: UpdateSettingsProps) {
  const view = deriveUpdate(props);
  return (
    <Card
      className="flex flex-col gap-4"
      data-testid="update-settings"
      role="region"
      aria-label={`${view.title} updates`}
    >
      <UpdateHeader
        title={view.title}
        badge={view.badge}
        currentVersion={view.currentVersion}
        error={view.error}
        released={view.released}
      />
      <UpdateStatus
        status={view.status}
        detail={view.detail}
        checkedAt={view.checkedAt}
        showCheckedAt={view.showCheckedAt}
      />
      {view.phase === "downloading" && view.progress !== null && (
        <UpdateProgress percent={view.percent} text={view.progressText} />
      )}
      <ReleaseNotes notes={view.notes} />
      {view.error !== null && (
        <Text size="sm" tone="danger" role="alert">
          {view.error}
        </Text>
      )}
      <UpdateActions
        phase={view.phase}
        available={view.available}
        canDownload={view.canDownload}
        installDirectly={view.installDirectly}
        error={view.error}
        handlers={view.handlers}
      />
    </Card>
  );
}

function UpdateHeader(props: {
  readonly title: string;
  readonly badge: string | null;
  readonly currentVersion: string | null;
  readonly error: string | null;
  readonly released: string | null;
}) {
  const { title, badge, currentVersion, error, released } = props;
  const version = currentVersion
    ? `Current version: v${currentVersion}`
    : error !== null
      ? "Current version: Unavailable"
      : "Current version: Loading…";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold text-text">{title}</h3>
        {badge !== null && (
          <span className="rounded-full border border-border bg-surface-3 px-2 py-0.5 font-mono text-[11px] text-text-muted">
            {badge}
          </span>
        )}
      </div>
      <Text size="xs" tone="muted">
        {version}
        {released !== null ? ` · Released ${released}` : ""}
      </Text>
    </div>
  );
}

function UpdateStatus(props: {
  readonly status: string;
  readonly detail: string | null;
  readonly checkedAt: string | null;
  readonly showCheckedAt: boolean;
}) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-1">
      <Text size="sm">{props.status}</Text>
      {props.detail !== null && (
        <Text size="sm" tone="muted">
          {props.detail}
        </Text>
      )}
      {props.showCheckedAt && (
        <Text size="xs" tone="muted">
          Last checked {props.checkedAt}
        </Text>
      )}
    </div>
  );
}

export function UpdateProgress(props: {
  readonly percent: number | null;
  readonly text: string | null;
}) {
  const { percent, text } = props;
  return (
    <div className="flex items-center gap-2.5" data-testid="update-progress">
      <div
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-label="Update download progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        <div
          className={cn(
            "h-full rounded-full bg-accent transition-[width] duration-300",
            percent === null && "w-1/3 animate-pulse",
          )}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      {text !== null && (
        <Text size="xs" tone="muted" className="tabular-nums">
          {text}
        </Text>
      )}
    </div>
  );
}

function UpdateActions(props: {
  readonly phase: UpdatePhase;
  readonly available: boolean;
  readonly canDownload: boolean;
  readonly installDirectly: boolean;
  readonly error: string | null;
  readonly handlers: PrimaryHandlers;
}) {
  const { phase, available, canDownload, installDirectly, error, handlers } = props;
  const primary: PrimaryAction | null = primaryAction({
    phase,
    available,
    ready: phase === "ready",
    installDirectly,
    error,
  });
  const busy = phase === "checking" || phase === "downloading" || phase === "restarting";
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        loading={phase === "checking"}
        onClick={handlers.check}
      >
        Check for updates
      </Button>
      {primary !== null && (
        <Button
          size="sm"
          disabled={busy || !canDownload}
          loading={primary.busy}
          onClick={resolvePrimary(primary, handlers)}
        >
          {primary.label}
        </Button>
      )}
    </div>
  );
}

/** Desktop (Tauri) client updates, rendered inside user settings. */
export function DesktopUpdateSettings() {
  const update = useDesktopUpdates();
  if (!isDesktop()) {
    return null;
  }
  const progress = update.progress;
  const pubDate = update.status?.pubDate;
  const releaseDate =
    pubDate === null || pubDate === undefined ? null : new Date(pubDate * 1000).toISOString();
  const detail =
    update.phase === "ready"
      ? "Restart when you’re ready. The update installs then."
      : update.phase === "idle"
        ? "Aulora checks automatically every six hours."
        : null;
  return (
    <UpdateSettings
      title="Desktop app"
      currentVersion={update.currentVersion}
      latestVersion={update.status?.version ?? null}
      releaseDate={releaseDate}
      available={update.status?.updateAvailable ?? false}
      checked={update.status !== null && update.status.error === null}
      lastCheckedAt={update.checkedAt}
      phase={update.phase}
      error={update.error}
      notes={update.status?.notes ?? null}
      detail={detail}
      progress={progress}
      onCheck={() => void update.check()}
      onDownload={() => void update.download()}
      onRestart={() => void update.restart()}
    />
  );
}
