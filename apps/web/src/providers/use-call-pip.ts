/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildPipState,
  PIP_ACTION_EVENT,
  PIP_CLOSED_EVENT,
  PIP_STATE_EVENT,
  PIP_WINDOW_LABEL,
  type PipCallState,
  parsePipAction,
} from "../lib/call-pip";
import {
  closeDesktopPipWindow,
  emitDesktopEventTo,
  isDesktopPipWindowOpen,
  listenDesktopEvent,
  openDesktopPipWindow,
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
/**
 * How often the shell's call window is refreshed while a call runs. It is a
 * second webview, so every update crosses IPC: often enough that a speaking ring
 * and a mute press feel live, rarely enough to cost nothing. Duplicate states
 * are dropped, so a quiet call sends nothing.
 */
const DESKTOP_STATE_INTERVAL_MS = 250;
/**
 * How long an unchanged state is repeated. The window's webview takes a moment
 * to load and subscribe, so the first frame can arrive before anything is
 * listening; the heartbeat covers that without resending on every tick.
 */
const DESKTOP_STATE_HEARTBEAT_MS = 2_000;

export interface PipControl {
  readonly mode: PipMode;
  /** Whether the call is currently floating. */
  readonly active: boolean;
  /**
   * Opens or closes picture-in-picture. Call it from a click: browsers only
   * allow it from a user action. `nameOf` labels the participants a floating
   * surface shows, and is only needed where the surface cannot ask for itself.
   */
  toggle(nameOf?: (userId: string) => string): void;
}

/** What the page should draw into the floating surface, if it is one the page draws. */
export interface PipSurface {
  /**
   * The Document Picture-in-Picture window to portal the call UI into. The
   * desktop shell's call window is a separate webview with its own entry, so it
   * is not a portal target.
   */
  readonly window: Window | null;
}

export interface CallPipOptions {
  readonly callActive: boolean;
  readonly snapshot: VoiceSnapshot;
  readonly selfUserId: string;
  readonly canSpeak: boolean;
  readonly canVideo: boolean;
  readonly canStream: boolean;
  /** Keeps the app window above others while the in-page dock is pinned. */
  readonly pinned: boolean;
  readonly controls: {
    readonly toggleMicrophone: () => void;
    readonly toggleDeafen: () => void;
    readonly toggleCamera: () => void;
    readonly toggleScreen: () => void;
    readonly hangUp: () => void;
  };
}

const IDENTITY = (userId: string): string => userId;

/**
 * Picture-in-picture for the active call, in whichever form this platform has.
 * Holds the state (rather than the call dock) so the floating window survives
 * moving between views, and registers the call with the browser so it can open
 * the window by itself when the user switches away.
 *
 * On the desktop the window is the shell's own: it lives in a second webview, so
 * this hook is only the main window's half of it — it opens and closes the
 * window, streams the call to it and runs the controls it sends back.
 */
export function useCallPip(options: CallPipOptions): { pip: PipControl; surface: PipSurface } {
  const { callActive, snapshot, selfUserId, canSpeak, canVideo, canStream, pinned, controls } =
    options;
  const mode = useMemo(detectPipMode, []);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [floatingVideo, setFloatingVideo] = useState(false);
  const windowRef = useRef<Window | null>(null);
  const desktopOpenRef = useRef(false);
  const videoRef = useRef<VideoPip | null>(null);
  const nameOf = useRef(IDENTITY);
  const latest = useRef({ snapshot, selfUserId, canSpeak, canVideo, canStream, pinned, controls });
  latest.current = { snapshot, selfUserId, canSpeak, canVideo, canStream, pinned, controls };
  // The main window's half of the call window's state: the newest snapshot to
  // send, and the last one that actually went out.
  const pendingState = useRef<PipCallState | null>(null);
  const sentState = useRef<string | null>(null);
  const sentAt = useRef(0);

  const close = useCallback(() => {
    windowRef.current?.close();
    windowRef.current = null;
    setPipWindow(null);
    if (desktopOpenRef.current) {
      desktopOpenRef.current = false;
      setDesktopOpen(false);
      // Clearing the last sent state makes the next open broadcast immediately.
      sentState.current = null;
      sentAt.current = 0;
      void closeDesktopPipWindow();
    }
    videoRef.current?.stop();
    videoRef.current = null;
    setFloatingVideo(false);
  }, []);

  const source = useCallback(
    (): PipSource =>
      pickPipSource(latest.current.snapshot, latest.current.selfUserId, nameOf.current),
    [],
  );

  const open = useCallback(async () => {
    if (windowRef.current !== null || desktopOpenRef.current || videoRef.current !== null) {
      return;
    }
    if (mode === "window") {
      if (await openDesktopPipWindow(PIP_WIDTH, PIP_HEIGHT)) {
        desktopOpenRef.current = true;
        setDesktopOpen(true);
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
  }, [mode, source]);

  const active = pipWindow !== null || desktopOpen || floatingVideo;
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

  // The call ending closes whatever is floating, including a call window that
  // outlived it after a reload.
  useEffect(() => {
    if (!callActive) {
      close();
      if (mode === "window") {
        void closeDesktopPipWindow();
      }
    }
  }, [callActive, close, mode]);

  // A call window still open from before a reload is adopted, so the call keeps
  // floating instead of the app quietly pretending it does not.
  useEffect(() => {
    if (mode !== "window" || !callActive) {
      return;
    }
    let disposed = false;
    void isDesktopPipWindowOpen().then((open) => {
      if (disposed || !open || desktopOpenRef.current) {
        return;
      }
      desktopOpenRef.current = true;
      setDesktopOpen(true);
    });
    return () => {
      disposed = true;
    };
  }, [mode, callActive]);

  // The shell says when the call window is gone (its own button, Alt+F4 or the
  // window manager). The call carries on; only the floating state ends.
  useEffect(() => {
    if (!desktopOpen) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenDesktopEvent(PIP_CLOSED_EVENT, () => {
      desktopOpenRef.current = false;
      setDesktopOpen(false);
      sentState.current = null;
      sentAt.current = 0;
    }).then((off) => {
      if (disposed) {
        off();
      } else {
        unlisten = off;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [desktopOpen]);

  // Controls pressed in the call window reach the call through the same helpers
  // the browser's media keys use. Subscribed even when the window is closed: the
  // actions are harmless and a press cannot arrive without a window.
  useEffect(() => {
    if (mode !== "window") {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenDesktopEvent(PIP_ACTION_EVENT, (payload) => {
      const action = parsePipAction(payload);
      if (action === null) {
        return;
      }
      switch (action) {
        case "toggle-mute":
          latest.current.controls.toggleMicrophone();
          break;
        case "toggle-deafen":
          latest.current.controls.toggleDeafen();
          break;
        case "toggle-camera":
          latest.current.controls.toggleCamera();
          break;
        case "toggle-screen":
          latest.current.controls.toggleScreen();
          break;
        case "leave":
          latest.current.controls.hangUp();
          break;
      }
    }).then((off) => {
      if (disposed) {
        off();
      } else {
        unlisten = off;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [mode]);

  // What the call window should draw. Built on every snapshot change and sent by
  // the timer below, so a burst of level-meter updates cannot flood the IPC.
  const desktopState = useMemo<PipCallState | null>(() => {
    if (mode !== "window" || !desktopOpen) {
      return null;
    }
    return buildPipState({
      call: snapshot.call,
      local: snapshot.local,
      remoteSpeaking: snapshot.remoteSpeaking,
      localSpeaking: snapshot.localSpeaking,
      selfUserId,
      canSpeak,
      canVideo,
      canStream,
      nameOf: nameOf.current,
    });
  }, [mode, desktopOpen, snapshot, selfUserId, canSpeak, canVideo, canStream]);

  useEffect(() => {
    pendingState.current = desktopState;
  }, [desktopState]);

  useEffect(() => {
    if (!desktopOpen) {
      return;
    }
    const flush = (force: boolean) => {
      const state = pendingState.current;
      if (state === null) {
        return;
      }
      const serialized = JSON.stringify(state);
      const now = Date.now();
      if (
        !force &&
        serialized === sentState.current &&
        now - sentAt.current < DESKTOP_STATE_HEARTBEAT_MS
      ) {
        return;
      }
      sentState.current = serialized;
      sentAt.current = now;
      void emitDesktopEventTo(PIP_WINDOW_LABEL, PIP_STATE_EVENT, state);
    };
    // The first frame goes out at once, so the window is never left blank.
    flush(true);
    const timer = setInterval(() => flush(false), DESKTOP_STATE_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [desktopOpen]);

  // Pinning keeps the app window above every other app while the dock is used.
  // The call window is always on top by construction.
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
  const surface = useMemo<PipSurface>(() => ({ window: pipWindow }), [pipWindow]);
  return { pip, surface };
}
