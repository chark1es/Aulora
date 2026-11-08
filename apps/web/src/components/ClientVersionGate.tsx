/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import {
  type ClientVersionPolicy,
  type ClientVersionState,
  clientVersionState,
} from "@aulora/core";
import { Button, Card, Icon, Text } from "@aulora/ui-web";
import { useQuery } from "convex/react";
import { useCallback, useState } from "react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { CLIENT_VERSION } from "../lib/client-version";
import {
  checkDesktopUpdate,
  downloadDesktopUpdate,
  installDesktopUpdate,
  isDesktop,
} from "../lib/desktop";

import {
  ConnectionRecoveryActions,
  type ConnectionRecoveryActionsProps,
} from "./ConnectionRecoveryActions";

const DISMISSED_KEY = "aulora:client-version-dismissed";

/** The server's advertised compatibility policy, or `null` while it loads. */
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- `ClientVersionPolicy` comes from @aulora/core, which this linter cannot resolve
export function useClientVersionPolicy(): ClientVersionPolicy | null {
  const config = useQuery(api.server.publicConfig, {});
  if (config === undefined) {
    return null;
  }
  return {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- absent on servers from before this release
    minClientVersion: config.clientVersion?.minClientVersion ?? null,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- absent on servers from before this release
    recommendedClientVersion: config.clientVersion?.recommendedClientVersion ?? null,
  };
}

/**
 * The connected server's version when it is older than this client can talk to,
 * otherwise `null` (also while the config loads). Servers from before this
 * release never send `features`, and the shell relies on the queries that
 * arrived with it, so such a server would break the app instead of degrading.
 * New clients keep working against new servers and old clients against new
 * servers; only this newer-client-than-server pairing needs the screen.
 */
export function useOutdatedServer(): { readonly version: string } | null {
  const config = useQuery(api.server.publicConfig, {});
  if (config === undefined || config.features !== undefined) {
    return null;
  }
  return { version: config.version };
}

/** Runs the platform's update path: the signed desktop updater or a reload. */
function useClientUpdateAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    setError(null);
    if (!isDesktop()) {
      globalThis.location.reload();
      return;
    }
    setBusy(true);
    try {
      const status = await checkDesktopUpdate();
      if (status === null) {
        setError("Update status is unavailable. Check again later.");
        return;
      }
      if (!status.updateAvailable) {
        setError("No newer desktop build is published for this platform yet.");
        return;
      }
      await downloadDesktopUpdate();
      await installDesktopUpdate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the update.");
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, desktop: isDesktop() };
}

function versionLabel(version: string | null | undefined): string {
  return version === null || version === undefined || version.trim().length === 0
    ? "a newer release"
    : `v${version}`;
}

/** How the running client identifies itself in update copy. */
const RUNNING_VERSION =
  CLIENT_VERSION === "0.0.0-dev" ? "a development build" : `v${CLIENT_VERSION}`;

/**
 * Hard gate for a client older than the server's minimum supported version.
 * The server still validates everything it is told; this screen only keeps an
 * outdated build from silently talking to an incompatible backend.
 */
export function ClientVersionRequired({ policy }: { readonly policy: ClientVersionPolicy }) {
  const action = useClientUpdateAction();
  return (
    <div className="pane flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <Card
        className="flex w-full max-w-md flex-col gap-4 p-6"
        data-testid="client-update-required"
      >
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Icon name="download" size={22} />
        </span>
        <div className="flex flex-col gap-1.5">
          <Text size="lg" className="font-semibold">
            Update required
          </Text>
          <Text tone="muted" size="sm">
            This workspace needs Aulora {versionLabel(policy.minClientVersion)} or newer. You are
            running {RUNNING_VERSION}.
          </Text>
          <Text tone="muted" size="sm">
            Update before signing in so your messages and calls stay compatible with the server.
          </Text>
        </div>
        {action.error !== null && (
          <Text tone="danger" size="sm" role="alert">
            {action.error}
          </Text>
        )}
        <Button loading={action.busy} onClick={() => void action.run()}>
          {action.desktop ? "Update now" : "Reload to update"}
        </Button>
      </Card>
    </div>
  );
}

/**
 * Shown when this app is newer than the server it is connected to. The fix is
 * on the server, so the person is told who has to act and can switch or remove
 * the workspace instead of being left on a broken screen.
 */
export function ServerUpdateRequired({
  serverVersion,
  recovery,
}: {
  readonly serverVersion: string;
  readonly recovery: ConnectionRecoveryActionsProps;
}) {
  return (
    <div className="pane flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <Card
        className="flex w-full max-w-md flex-col gap-4 p-6"
        data-testid="server-update-required"
      >
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Icon name="download" size={22} />
        </span>
        <div className="flex flex-col gap-1.5">
          <Text size="lg" className="font-semibold">
            This server needs an update
          </Text>
          <Text tone="muted" size="sm">
            The server runs Aulora {versionLabel(serverVersion)}, which is older than this app (
            {RUNNING_VERSION}). Ask a workspace administrator to update the server, then reconnect.
          </Text>
        </div>
        <ConnectionRecoveryActions {...recovery} />
      </Card>
    </div>
  );
}

function readDismissed(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- storage is absent when the browser disables it
    return globalThis.localStorage?.getItem(DISMISSED_KEY) ?? null;
  } catch {
    return null;
  }
}

function persistDismissed(version: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- storage is absent when the browser disables it
    globalThis.localStorage?.setItem(DISMISSED_KEY, version);
  } catch {
    // Storage can be disabled; the banner simply returns on the next visit.
  }
}

/**
 * Non-blocking recommendation. Dismissal is keyed by the recommended version,
 * so a later recommendation reappears, but the same one stays dismissed.
 */
export function ClientVersionNotice({
  recommendedVersion,
}: {
  readonly recommendedVersion: string | null | undefined;
}) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const action = useClientUpdateAction();
  if (recommendedVersion === null || recommendedVersion === undefined) {
    return null;
  }
  const state: ClientVersionState = clientVersionState(CLIENT_VERSION, {
    recommendedClientVersion: recommendedVersion,
  });
  if (state !== "recommended" || dismissed === recommendedVersion) {
    return null;
  }
  return (
    <div className="desktop-titlebar-offset pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3">
      <Card
        className="pointer-events-auto flex w-full max-w-md items-center gap-3 p-3 shadow-lg"
        data-testid="client-version-notice"
        role="status"
      >
        <Icon name="download" size={16} />
        <Text size="sm" className="min-w-0 flex-1">
          Aulora {versionLabel(recommendedVersion)} is available. You are running {RUNNING_VERSION}.
        </Text>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            persistDismissed(recommendedVersion);
            setDismissed(recommendedVersion);
          }}
        >
          Later
        </Button>
        <Button size="sm" loading={action.busy} onClick={() => void action.run()}>
          {action.desktop ? "Update" : "Reload"}
        </Button>
      </Card>
    </div>
  );
}
