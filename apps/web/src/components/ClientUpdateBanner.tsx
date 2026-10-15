/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, Card, Icon, Text } from "@aulora/ui-web";
import { useState } from "react";
import { isDesktop } from "../lib/desktop";
import { type UpdatePhase, useDesktopUpdates } from "../providers/DesktopUpdateProvider";
import { UpdateProgress } from "./UpdateSettings";
import {
  downloadLabel,
  downloadPercent,
  type PrimaryAction,
  type PrimaryHandlers,
  primaryAction,
  resolvePrimary,
  statusText,
  versionTransition,
} from "./updateViewModel";

interface BannerView {
  readonly badge: string | null;
  readonly status: string;
  readonly phase: UpdatePhase;
  readonly percent: number | null;
  readonly progressText: string | null;
  readonly showProgress: boolean;
  readonly error: string | null;
}

/**
 * A self-contained, non-modal desktop-update pill shown on every route —
 * including the connect and sign-in screens — so the client can be updated
 * before signing in to a workspace. It reads only the Tauri bridge through
 * `DesktopUpdateProvider`, never a Convex client, so it works outside the
 * workspace session entirely. On the web build it renders nothing.
 */
export function ClientUpdateBanner() {
  const update = useDesktopUpdates();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const latest = update.status?.version ?? null;
  if (!isDesktop() || latest === null || dismissed === latest) {
    return null;
  }
  const phase = update.phase;
  const available = update.status?.updateAvailable ?? false;
  const ready = phase === "ready";
  const error = update.error;
  const active = available || phase === "downloading" || ready || phase === "restarting";
  const action = primaryAction({ phase, available, ready, installDirectly: false, error });
  if (!active || action === null) {
    return null;
  }
  const view: BannerView = {
    badge: versionTransition(update.currentVersion, latest),
    status: statusText({
      phase,
      available,
      ready,
      latestVersion: latest,
      checked: true,
      installDirectly: false,
    }),
    phase,
    percent: downloadPercent(update.progress),
    progressText: downloadLabel(update.progress),
    showProgress: phase === "downloading" && update.progress !== null,
    error,
  };
  const handlers: PrimaryHandlers = {
    check: () => void update.check(),
    download: () => void update.download(),
    restart: () => void update.restart(),
  };
  return (
    <UpdateBannerCard
      view={view}
      action={action}
      handlers={handlers}
      onDismiss={() => {
        setDismissed(latest);
      }}
    />
  );
}

function UpdateBannerCard(props: {
  readonly view: BannerView;
  readonly action: PrimaryAction;
  readonly handlers: PrimaryHandlers;
  readonly onDismiss: () => void;
}) {
  const { view, action, handlers, onDismiss } = props;
  const busy = view.phase === "downloading" || view.phase === "restarting";
  return (
    <div className="desktop-titlebar-offset pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3">
      <Card
        className="pointer-events-auto flex w-full max-w-md flex-col gap-3 p-3.5 shadow-lg"
        data-testid="client-update-banner"
        role="region"
        aria-label="Desktop update"
      >
        <BannerHeader badge={view.badge} status={view.status} />
        {view.showProgress && <UpdateProgress percent={view.percent} text={view.progressText} />}
        {view.error !== null && (
          <Text size="xs" tone="danger" role="alert">
            {view.error}
          </Text>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Later
          </Button>
          <Button
            size="sm"
            disabled={busy}
            loading={action.busy}
            onClick={resolvePrimary(action, handlers)}
          >
            {action.label}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function BannerHeader(props: { readonly badge: string | null; readonly status: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Icon name="download" size={16} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <Text size="sm" className="font-medium text-text">
            Aulora update
          </Text>
          {props.badge !== null && (
            <span className="rounded-full bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
              {props.badge}
            </span>
          )}
        </span>
        <Text size="xs" tone="muted" role="status" aria-live="polite">
          {props.status}
        </Text>
      </div>
    </div>
  );
}
