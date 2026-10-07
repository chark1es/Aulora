/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  enterDesktopMiniWindow,
  exitDesktopMiniWindow,
  isDesktopMiniWindow,
  setDesktopAlwaysOnTop,
} from "../lib/desktop";
import type { VoiceSnapshot } from "../lib/voice/call-types";
import {
  detectPipMode,
  openDocumentPip,
  type PipMode,
  registerCallSession,
} from "../lib/voice/pip";
import { type PipSource, pickPipSource } from "../lib/voice/pip-source";
import { startVideoPip, type VideoPip } from "../lib/voice/video-pip";

/** The floating window's size: wide enough for the controls, tall enough for a tile. */
const PIP_WIDTH = 380;
const PIP_HEIGHT = 292;
const SOURCE_REFRESH_MS = 500;

export interface PipControl {
  readonly mode: PipMode;
  /** Whether the call is currently floating. */
  readonly active: boolean;
  /**
   * Opens or closes picture-in-picture. Call it from a click: browsers only
   * allow it from a user action. `nameOf` labels the participant a floating
   * video shows, and is only needed where the mode is `video`.
   */
  toggle(nameOf?: (userId: string) => string): void;
}

/** What the page should draw into the floating surface, if it is one the page draws. */
export interface PipSurface {
  /** The Document Picture-in-Picture window to portal the call UI into. */
  readonly window: Window | null;
  /** The desktop window is currently the small picture-in-picture window. */
  readonly mini: boolean;
}

export interface CallPipOptions {
  readonly callActive: boolean;
  readonly snapshot: VoiceSnapshot;
  readonly selfUserId: string;
  /** Keeps the window above others. On desktop this is the real always-on-top. */
  readonly pinned: boolean;
  readonly setPinned: (pinned: boolean) => void;
  readonly controls: {
    readonly toggleMicrophone: () => void;
    readonly toggleCamera: () => void;
    readonly hangUp: () => void;
  };
}

const IDENTITY = (userId: string): string => userId;

/**
 * Picture-in-picture for the active call, in whichever form this platform has.
 * Holds the state (rather than the call dock) so the floating window survives
 * moving between views, and registers the call with the browser so it can open
 * the window by itself when the user switches away.
 */
export function useCallPip(options: CallPipOptions): { pip: PipControl; surface: PipSurface } {
  const { callActive, snapshot, selfUserId, pinned, setPinned, controls } = options;
  const mode = useMemo(detectPipMode, []);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [mini, setMini] = useState(false);
  const [floatingVideo, setFloatingVideo] = useState(false);
  const windowRef = useRef<Window | null>(null);
  const miniRef = useRef(false);
  const videoRef = useRef<VideoPip | null>(null);
  const pinnedByPip = useRef(false);
  const nameOf = useRef(IDENTITY);
  const latest = useRef({ snapshot, selfUserId, pinned, controls });
  latest.current = { snapshot, selfUserId, pinned, controls };

  const close = useCallback(() => {
    windowRef.current?.close();
    windowRef.current = null;
    setPipWindow(null);
    if (miniRef.current) {
      miniRef.current = false;
      setMini(false);
      void exitDesktopMiniWindow();
      if (pinnedByPip.current) {
        pinnedByPip.current = false;
        setPinned(false);
      }
    }
    videoRef.current?.stop();
    videoRef.current = null;
    setFloatingVideo(false);
  }, [setPinned]);

  const source = useCallback(
    (): PipSource =>
      pickPipSource(latest.current.snapshot, latest.current.selfUserId, nameOf.current),
    [],
  );

  const open = useCallback(async () => {
    if (windowRef.current !== null || miniRef.current || videoRef.current !== null) {
      return;
    }
    if (mode === "window") {
      if (await enterDesktopMiniWindow(PIP_WIDTH, PIP_HEIGHT)) {
        miniRef.current = true;
        setMini(true);
        // A small window that slips behind other apps defeats the purpose.
        if (!latest.current.pinned) {
          pinnedByPip.current = true;
          setPinned(true);
        }
      }
    } else if (mode === "document") {
      const created = await openDocumentPip(PIP_WIDTH, PIP_HEIGHT);
      if (created !== null) {
        created.addEventListener("pagehide", () => {
          if (windowRef.current === created) {
            windowRef.current = null;
            setPipWindow(null);
          }
        });
        windowRef.current = created;
        setPipWindow(created);
      }
    } else if (mode === "video") {
      try {
        videoRef.current = await startVideoPip(source(), () => {
          videoRef.current = null;
          setFloatingVideo(false);
        });
        setFloatingVideo(true);
      } catch {
        videoRef.current = null;
      }
    }
  }, [mode, setPinned, source]);

  const active = pipWindow !== null || mini || floatingVideo;
  const activeRef = useRef(active);
  activeRef.current = active;

  const toggle = useCallback(
    (names?: (userId: string) => string) => {
      nameOf.current = names ?? IDENTITY;
      if (activeRef.current) {
        close();
      } else {
        void open();
      }
    },
    [close, open],
  );

  // The call ending closes whatever is floating.
  useEffect(() => {
    if (!callActive) {
      close();
    }
  }, [callActive, close]);

  // A desktop window left small by a reload goes back to normal.
  useEffect(() => {
    if (mode !== "window") {
      return;
    }
    void isDesktopMiniWindow().then((small) => {
      if (small && !miniRef.current) {
        void exitDesktopMiniWindow();
      }
    });
  }, [mode]);

  // Pinning keeps the desktop window above every other app.
  useEffect(() => {
    void setDesktopAlwaysOnTop(pinned);
    return () => {
      void setDesktopAlwaysOnTop(false);
    };
  }, [pinned]);

  // Register the call with the browser: auto picture-in-picture and media keys.
  useEffect(() => {
    if (!callActive) {
      return;
    }
    return registerCallSession({
      enterPictureInPicture: mode === "document" ? () => void open() : undefined,
      toggleMicrophone: () => {
        latest.current.controls.toggleMicrophone();
      },
      toggleCamera: () => {
        latest.current.controls.toggleCamera();
      },
      hangUp: () => {
        latest.current.controls.hangUp();
      },
    });
  }, [callActive, mode, open]);

  // Keep a floating video on whoever is worth watching.
  useEffect(() => {
    if (!floatingVideo) {
      return;
    }
    const timer = setInterval(() => {
      videoRef.current?.setSource(source());
    }, SOURCE_REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [floatingVideo, source]);

  const pip = useMemo<PipControl>(() => ({ mode, active, toggle }), [mode, active, toggle]);
  const surface = useMemo<PipSurface>(() => ({ window: pipWindow, mini }), [pipWindow, mini]);
  return { pip, surface };
}
