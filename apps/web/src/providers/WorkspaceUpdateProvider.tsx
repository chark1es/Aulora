import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { UpdateSettings } from "../components/UpdateSettings";
import type { UpdatePhase } from "./DesktopUpdateProvider";

type CheckResult = FunctionReturnType<typeof api.updates.check>;
interface WorkspaceUpdates {
  readonly available: boolean;
  readonly settings: ReactNode;
}
const Context = createContext<WorkspaceUpdates>({ available: false, settings: null });
export const useWorkspaceUpdates = () => useContext(Context);

export function WorkspaceUpdateProvider({
  isOwner,
  children,
}: {
  readonly isOwner: boolean;
  readonly children: ReactNode;
}) {
  const currentVersion = useQuery(api.updates.version, isOwner ? {} : "skip");
  const host = useQuery(api.updates.status, isOwner ? {} : "skip");
  const capabilities = useQuery(api.updates.capabilities, isOwner ? {} : "skip");
  const checkRelease = useAction(api.updates.check);
  const installCoolify = useAction(api.updates.installCoolify);
  const request = useMutation(api.updates.request);
  const [result, setResult] = useState<CheckResult>();
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const restartingFrom = useRef<string | null>(null);
  const [now, setNow] = useState(Date.now);
  // `now` only needs to advance far enough to notice that the host heartbeat
  // went stale (`hostSeenAt + 30s`). A fixed 5 s tick re-rendered the wrapped
  // chat surface for owners even with no update in flight, so schedule a single
  // timeout at the staleness deadline instead and let heartbeat updates re-arm it.
  const hostSeenAt = host?.hostSeenAt;
  useEffect(() => {
    if (!isOwner || hostSeenAt === undefined) return;
    const deadline = hostSeenAt + 30_000;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      setNow((current) => (current < deadline ? Date.now() : current));
      return;
    }
    const timer = setTimeout(() => {
      setNow(Date.now());
    }, remaining);
    return () => {
      clearTimeout(timer);
    };
  }, [isOwner, hostSeenAt]);
  const check = useCallback(async () => {
    if (!isOwner || busy.current) return;
    busy.current = true;
    setError(null);
    setPhase("checking");
    try {
      const next = await checkRelease({});
      if (next.error) setError(next.error);
      else {
        setResult(next);
        // Stamp the check time; `now` no longer advances on a fixed tick.
        setNow(Date.now());
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Update check failed. Try again.");
    } finally {
      busy.current = false;
      setPhase("idle");
    }
  }, [isOwner, checkRelease]);
  const hostConnected = host != null && now - host.hostSeenAt < 30_000;
  useEffect(() => {
    if (!isOwner) return;
    // The host watcher is authoritative while its heartbeat is fresh, so skip
    // the redundant release check in that case (manual Check still routes
    // through `checkNow`). Re-run the check when the heartbeat goes stale.
    if (!hostConnected) void check();
    const timer = setInterval(
      () => {
        if (!hostConnected) void check();
      },
      6 * 60 * 60 * 1000,
    );
    return () => {
      clearInterval(timer);
    };
  }, [check, isOwner, hostConnected]);

  const coolify = capabilities?.provider === "coolify";
  const managed = coolify ? capabilities.status : null;
  // A live watcher is authoritative, including its prepared release version.
  const useHost = !coolify && host != null && (hostConnected || host.phase !== "idle");
  const installed =
    managed?.phase === "installed" &&
    managed.targetVersion === currentVersion &&
    managed.targetVersion === result?.latestVersion;
  const available =
    managed?.phase === "installing" ||
    (!installed && (useHost ? host.updateAvailable : (result?.updateAvailable ?? false)));
  const shownPhase =
    managed?.phase === "installing"
      ? "restarting"
      : useHost && (hostConnected || host.phase === "ready")
        ? host.phase
        : phase;
  const install = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setPhase("restarting");
    restartingFrom.current = currentVersion ?? null;
    try {
      await installCoolify({});
    } catch (cause) {
      restartingFrom.current = null;
      setError(
        cause instanceof Error ? cause.message : "Could not start the Coolify update. Try again.",
      );
    } finally {
      busy.current = false;
      setPhase("idle");
    }
  }, [currentVersion, installCoolify]);
  const send = useCallback(
    async (command: "download" | "restart") => {
      if (busy.current) return;
      busy.current = true;
      setError(null);
      try {
        await request({ command });
        if (command === "restart") restartingFrom.current = host?.currentVersion ?? null;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Update request failed. Try again.");
      } finally {
        busy.current = false;
      }
    },
    [host, request],
  );
  const checkNow = useCallback(async () => {
    if (hostConnected && !coolify) {
      try {
        setError(null);
        await request({ command: "check" });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Update check failed. Try again.");
      }
    } else await check();
  }, [check, coolify, hostConnected, request]);
  useEffect(() => {
    if (coolify && managed?.phase === "installed" && restartingFrom.current !== null) {
      restartingFrom.current = null;
      globalThis.location.reload();
      return;
    }
    if (
      restartingFrom.current !== null &&
      !coolify &&
      host?.phase === "idle" &&
      host.error === null &&
      host.currentVersion !== restartingFrom.current
    ) {
      restartingFrom.current = null;
      globalThis.location.reload();
    }
  }, [host, coolify, managed?.phase]);
  const settings = useMemo(
    () => (
      <>
        {isOwner ? (
          <UpdateSettings
            title="Workspace instance"
            currentVersion={useHost ? host.currentVersion : (currentVersion ?? null)}
            latestVersion={
              managed?.phase === "installing"
                ? managed.targetVersion
                : useHost
                  ? host.latestVersion
                  : (result?.latestVersion ?? null)
            }
            available={available}
            checked={useHost ? host.checkedAt > 0 : result !== undefined}
            phase={shownPhase}
            error={
              error ??
              capabilities?.error ??
              managed?.error ??
              (useHost ? host.error : result?.error) ??
              null
            }
            notes={(useHost ? host.notes : result?.notes) ?? null}
            releaseDate={useHost ? null : (result?.pubDate ?? null)}
            lastCheckedAt={
              useHost
                ? host.checkedAt > 0
                  ? host.checkedAt
                  : null
                : result !== undefined
                  ? now
                  : null
            }
            canDownload={
              capabilities !== undefined && (coolify ? capabilities.configured : hostConnected)
            }
            installDirectly={coolify}
            detail={
              coolify
                ? "Coolify builds and installs the release in one step. Deployment briefly interrupts the workspace for everyone."
                : !hostConnected
                  ? "The server updater is offline. Start infra/docker/update.sh --watch on the server to enable Download and Restart."
                  : shownPhase === "ready"
                    ? "Restarting briefly takes the workspace offline for everyone. Your messages and settings are kept."
                    : "The server prepares the release while your workspace stays online."
            }
            onCheck={() => void checkNow()}
            onDownload={() => void (coolify ? install() : send("download"))}
            onRestart={() => void send("restart")}
          />
        ) : null}
      </>
    ),
    [
      available,
      capabilities,
      checkNow,
      coolify,
      currentVersion,
      error,
      host,
      hostConnected,
      install,
      isOwner,
      managed,
      now,
      result,
      send,
      shownPhase,
      useHost,
    ],
  );
  const value = useMemo(
    () => ({ available: isOwner && available, settings }),
    [isOwner, available, settings],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
