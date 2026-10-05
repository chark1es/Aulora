import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
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
  const checkRelease = useAction(api.updates.check);
  const request = useMutation(api.updates.request);
  const [result, setResult] = useState<CheckResult>();
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const restartingFrom = useRef<string | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!isOwner) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 5000);
    return () => {
      clearInterval(timer);
    };
  }, [isOwner]);
  const check = useCallback(async () => {
    if (!isOwner || busy.current) return;
    busy.current = true;
    setError(null);
    setPhase("checking");
    try {
      const next = await checkRelease({});
      if (next.error) setError(next.error);
      else setResult(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Update check failed. Try again.");
    } finally {
      busy.current = false;
      setPhase("idle");
    }
  }, [isOwner, checkRelease]);
  useEffect(() => {
    if (!isOwner) return;
    void check();
    const timer = setInterval(() => void check(), 6 * 60 * 60 * 1000);
    return () => {
      clearInterval(timer);
    };
  }, [check, isOwner]);

  const hostConnected = host != null && now - host.hostSeenAt < 30_000;
  // A live watcher is authoritative, including its prepared release version.
  const useHost = host != null && (hostConnected || host.phase !== "idle");
  const available = useHost ? host.updateAvailable : (result?.updateAvailable ?? false);
  const shownPhase = useHost && (hostConnected || host.phase === "ready") ? host.phase : phase;
  async function send(command: "download" | "restart") {
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
  }
  async function checkNow() {
    if (hostConnected) {
      try {
        setError(null);
        await request({ command: "check" });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Update check failed. Try again.");
      }
    } else await check();
  }
  useEffect(() => {
    if (
      restartingFrom.current !== null &&
      host?.phase === "idle" &&
      host.error === null &&
      host.currentVersion !== restartingFrom.current
    ) {
      restartingFrom.current = null;
      globalThis.location.reload();
    }
  }, [host]);
  const settings = (
    <>
      {isOwner ? (
        <UpdateSettings
          title="Workspace instance"
          currentVersion={useHost ? host.currentVersion : (currentVersion ?? null)}
          latestVersion={useHost ? host.latestVersion : (result?.latestVersion ?? null)}
          available={available}
          checked={useHost ? host.checkedAt > 0 : result !== undefined}
          phase={shownPhase}
          error={error ?? (useHost ? host.error : result?.error) ?? null}
          notes={(useHost ? host.notes : result?.notes) ?? null}
          canDownload={hostConnected}
          detail={
            !hostConnected
              ? "To download and install from settings, start infra/docker/update.sh --watch on the server. For managed deployments, use your hosting provider's redeploy controls."
              : shownPhase === "ready"
                ? "Restarting briefly takes the workspace offline for everyone. Your messages and settings are kept."
                : "The server prepares the release while your workspace stays online."
          }
          onCheck={() => void checkNow()}
          onDownload={() => void send("download")}
          onRestart={() => void send("restart")}
        />
      ) : null}
    </>
  );
  return (
    <Context.Provider value={{ available: isOwner && available, settings }}>
      {children}
    </Context.Provider>
  );
}
