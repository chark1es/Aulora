import { Button, Text } from "@aulora/ui-web";
import { isDesktop } from "../lib/desktop";
import { type UpdatePhase, useDesktopUpdates } from "../providers/DesktopUpdateProvider";

export interface UpdateSettingsProps {
  readonly title: string;
  readonly currentVersion: string | null;
  readonly latestVersion: string | null;
  readonly available: boolean;
  readonly phase: UpdatePhase;
  readonly error: string | null;
  readonly notes?: string | null;
  readonly detail?: string | null;
  readonly canDownload?: boolean;
  readonly checked?: boolean;
  readonly onCheck: () => void;
  readonly onDownload: () => void;
  readonly onRestart: () => void;
}
export function UpdateSettings(props: UpdateSettingsProps) {
  const {
    title,
    currentVersion,
    latestVersion,
    available,
    phase,
    error,
    notes,
    detail,
    canDownload = true,
    checked = false,
    onCheck,
    onDownload,
    onRestart,
  } = props;
  const ready = phase === "ready" || phase === "restarting";
  const status = statusText({ phase, ready, available, latestVersion, checked });
  return (
    <section
      className="flex flex-col gap-3"
      data-testid="update-settings"
      aria-label={`${title} updates`}
    >
      <UpdateHeading title={title} currentVersion={currentVersion} error={error} />
      <div role="status" aria-live="polite" className="flex flex-col gap-1">
        <Text size="sm">{status}</Text>
        {detail && (
          <Text size="sm" tone="muted">
            {detail}
          </Text>
        )}
      </div>
      {notes && (
        <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text-muted">
          {notes.slice(0, 2000)}
        </p>
      )}
      {error && (
        <Text size="sm" tone="danger" role="alert">
          {error}
        </Text>
      )}
      <UpdateActions
        phase={phase}
        available={available}
        canDownload={canDownload}
        onCheck={onCheck}
        onDownload={onDownload}
        onRestart={onRestart}
      />
    </section>
  );
}

function UpdateHeading({
  title,
  currentVersion,
  error,
}: {
  readonly title: string;
  readonly currentVersion: string | null;
  readonly error: string | null;
}) {
  return (
    <div>
      <h3 className="text-[15px] font-semibold text-text">{title}</h3>
      <Text size="sm" tone="muted">
        Current version:{" "}
        {currentVersion ? `v${currentVersion}` : error ? "Unavailable" : "Loading…"}
      </Text>
    </div>
  );
}

function statusText({
  phase,
  ready,
  available,
  latestVersion,
  checked,
}: {
  readonly phase: UpdatePhase;
  readonly ready: boolean;
  readonly available: boolean;
  readonly latestVersion: string | null;
  readonly checked: boolean;
}): string {
  if (phase === "checking") {
    return "Checking for updates…";
  }
  if (phase === "downloading") {
    return "Downloading update…";
  }
  if (phase === "restarting") {
    return "Restarting to install the update…";
  }
  if (ready) {
    return `v${latestVersion} is downloaded and ready to install.`;
  }
  if (available) {
    return `v${latestVersion} is available.`;
  }
  if (latestVersion ?? checked) {
    return "No newer release is available.";
  }
  return "Check for a new release.";
}

function UpdateActions({
  phase,
  available,
  canDownload,
  onCheck,
  onDownload,
  onRestart,
}: {
  readonly phase: UpdatePhase;
  readonly available: boolean;
  readonly canDownload: boolean;
  readonly onCheck: () => void;
  readonly onDownload: () => void;
  readonly onRestart: () => void;
}) {
  const busy = phase === "checking" || phase === "downloading" || phase === "restarting";
  const ready = phase === "ready" || phase === "restarting";
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || ready}
        loading={phase === "checking"}
        onClick={onCheck}
      >
        Check for updates
      </Button>
      {(available || ready) &&
        (ready ? (
          <Button
            size="sm"
            disabled={busy || !canDownload}
            loading={phase === "restarting"}
            onClick={onRestart}
          >
            Restart to update
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={busy || !canDownload}
            loading={phase === "downloading"}
            onClick={onDownload}
          >
            Download update
          </Button>
        ))}
    </div>
  );
}

export function DesktopUpdateSettings() {
  const update = useDesktopUpdates();
  if (!isDesktop()) return null;
  const total = update.progress?.contentLength;
  const detail =
    update.phase === "downloading" && update.progress
      ? total
        ? `${Math.min(100, Math.round((update.progress.downloaded / total) * 100))}% downloaded`
        : `${(update.progress.downloaded / (1024 * 1024)).toFixed(1)} MB downloaded`
      : update.phase === "ready"
        ? "Restart when you're ready. The update will be installed then."
        : "Aulora checks automatically every six hours.";
  return (
    <UpdateSettings
      title="Desktop app"
      currentVersion={update.currentVersion}
      latestVersion={update.status?.version ?? null}
      available={update.status?.updateAvailable ?? false}
      checked={update.status !== null && update.status.error === null}
      phase={update.phase}
      error={update.error}
      notes={update.status?.notes ?? null}
      detail={detail}
      onCheck={() => void update.check()}
      onDownload={() => void update.download()}
      onRestart={() => void update.restart()}
    />
  );
}
