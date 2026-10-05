import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  checkDesktopUpdate,
  type DesktopUpdateProgress,
  type DesktopUpdateStatus,
  desktopVersion,
  downloadDesktopUpdate,
  installDesktopUpdate,
  isDesktop,
  listenDesktopEvent,
} from "../lib/desktop";

export type UpdatePhase = "idle" | "checking" | "downloading" | "ready" | "restarting";
interface DesktopUpdates {
  readonly status: DesktopUpdateStatus | null;
  readonly currentVersion: string | null;
  readonly phase: UpdatePhase;
  readonly error: string | null;
  readonly progress: DesktopUpdateProgress | null;
  readonly menuNote: string | null;
  check(): Promise<void>;
  download(): Promise<void>;
  restart(): Promise<void>;
}
const noop = () => Promise.resolve();
const Context = createContext<DesktopUpdates>({
  status: null,
  currentVersion: null,
  phase: "idle",
  error: null,
  progress: null,
  menuNote: null,
  check: noop,
  download: noop,
  restart: noop,
});
export const useDesktopUpdates = () => useContext(Context);

export function DesktopUpdateProvider({ children }: { readonly children: ReactNode }) {
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DesktopUpdateProgress | null>(null);
  const [menuNote, setMenuNote] = useState<string | null>(null);
  const busy = useRef(false);
  const ready = useRef(false);
  const isReady = useCallback(() => ready.current, []);
  const apply = useCallback((next: DesktopUpdateStatus) => {
    // Failed checks must not erase a known update or a verified download.
    if (next.currentVersion) setCurrentVersion(next.currentVersion);
    if (!next.error) setStatus(next);
    if (next.downloaded) {
      ready.current = true;
      setPhase("ready");
    }
    setError(next.error);
  }, []);

  const check = useCallback(async () => {
    if (!isDesktop() || busy.current || ready.current) return;
    busy.current = true;
    setPhase("checking");
    setError(null);
    try {
      const next = await checkDesktopUpdate();
      if (next) apply(next);
      else setError("Update status is unavailable. Try checking again.");
    } finally {
      busy.current = false;
      setPhase(isReady() ? "ready" : "idle");
    }
  }, [apply, isReady]);

  useEffect(() => {
    if (!isDesktop()) return;
    let disposed = false;
    const subscriptions: (() => void)[] = [];
    const register = async () => {
      try {
        for (const [event, handler] of [
          [
            "aulora://app-update",
            (payload: unknown) => {
              if (!isStatus(payload) || disposed || busy.current || ready.current) return;
              apply(payload);
              if (payload.source === "menu")
                setMenuNote(
                  payload.error ??
                    (payload.updateAvailable
                      ? "An app update is available in Your settings → Updates."
                      : "You're on the latest version."),
                );
            },
          ],
          [
            "aulora://app-update-progress",
            (payload: unknown) => {
              if (!disposed && isProgress(payload)) setProgress(payload);
            },
          ],
        ] as const) {
          const off = await listenDesktopEvent(event, handler);
          if (disposed) off();
          else subscriptions.push(off);
        }
        if (!disposed) void check();
      } catch (cause) {
        if (!disposed) setError(message(cause));
      }
    };
    void desktopVersion()
      .then((version) => {
        if (!disposed) setCurrentVersion(version);
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(message(cause));
      });
    void register();
    const interval = setInterval(
      () => {
        if (!disposed) void check();
      },
      6 * 60 * 60 * 1000,
    );
    return () => {
      disposed = true;
      clearInterval(interval);
      for (const off of subscriptions) off();
    };
  }, [apply, check]);

  useEffect(() => {
    if (menuNote === null) return;
    const timer = setTimeout(() => {
      setMenuNote(null);
    }, 8000);
    return () => {
      clearTimeout(timer);
    };
  }, [menuNote]);

  async function download() {
    if (busy.current || ready.current) return;
    busy.current = true;
    setPhase("downloading");
    setProgress(null);
    setError(null);
    try {
      await downloadDesktopUpdate();
      ready.current = true;
      setPhase("ready");
    } catch (cause) {
      setError(message(cause));
      setPhase("idle");
    } finally {
      busy.current = false;
    }
  }
  async function restart() {
    if (busy.current || !ready.current) return;
    busy.current = true;
    setPhase("restarting");
    setError(null);
    try {
      await installDesktopUpdate();
    } catch (cause) {
      setError(message(cause));
      setPhase("ready");
      busy.current = false;
    }
  }
  return (
    <Context.Provider
      value={{ status, currentVersion, phase, error, progress, menuNote, check, download, restart }}
    >
      {children}
    </Context.Provider>
  );
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Update failed. Try again.";
}
function isStatus(value: unknown): value is DesktopUpdateStatus {
  return (
    typeof value === "object" &&
    value !== null &&
    "updateAvailable" in value &&
    typeof value.updateAvailable === "boolean" &&
    "currentVersion" in value &&
    typeof value.currentVersion === "string"
  );
}
function isProgress(value: unknown): value is DesktopUpdateProgress {
  return (
    typeof value === "object" &&
    value !== null &&
    "downloaded" in value &&
    typeof value.downloaded === "number"
  );
}
