/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { isDesktop } from "../desktop";
import { videoPipSupported } from "./video-pip";

/**
 * Picture-in-picture for calls, in the best form each platform offers:
 *
 *  - `window`: the desktop app shrinks its own window to a small one that can
 *    float above others. Used whenever the desktop shell is present, because it
 *    is the only form that behaves identically on macOS, Windows and Linux.
 *  - `document`: Document Picture-in-Picture (Chrome and Edge), a real always-
 *    on-top window holding the call UI.
 *  - `video`: a floating video of one participant (Safari, Firefox).
 *  - `none`: nothing native; the call dock floats inside the page instead.
 */
export type PipMode = "window" | "document" | "video" | "none";

export function detectPipMode(): PipMode {
  if (isDesktop()) {
    return "window";
  }
  if (isDocumentPipSupported()) {
    return "document";
  }
  return videoPipSupported() ? "video" : "none";
}

export interface CallSessionActions {
  /** Open picture-in-picture; the browser fires this when the user leaves the tab. */
  readonly enterPictureInPicture?: (() => void) | undefined;
  readonly toggleMicrophone: () => void;
  readonly toggleCamera: () => void;
  readonly hangUp: () => void;
}

/**
 * Tells the browser this page is a call. That is what lets Chrome open
 * picture-in-picture by itself when the user switches tabs mid-call (it needs the
 * `enterpictureinpicture` handler plus an active camera or microphone), and it
 * puts mute, camera and hang-up on the media keys and the floating window.
 * Actions a browser does not know are skipped. Returns the unregister function.
 */
export function registerCallSession(actions: CallSessionActions): () => void {
  const session = typeof navigator === "undefined" ? undefined : navigator.mediaSession;
  if (session === undefined) {
    return () => {};
  }
  const handlers: [string, (() => void) | undefined][] = [
    ["enterpictureinpicture", actions.enterPictureInPicture],
    ["togglemicrophone", actions.toggleMicrophone],
    ["togglecamera", actions.toggleCamera],
    ["hangup", actions.hangUp],
  ];
  const registered: string[] = [];
  for (const [action, handler] of handlers) {
    if (handler === undefined) {
      continue;
    }
    try {
      session.setActionHandler(action as MediaSessionAction, handler);
      registered.push(action);
    } catch {
      // This browser does not support the action.
    }
  }
  return () => {
    for (const action of registered) {
      try {
        session.setActionHandler(action as MediaSessionAction, null);
      } catch {
        // Already gone.
      }
    }
  };
}

/**
 * Document Picture-in-Picture support (desktop Chrome/Edge). When unavailable the
 * call falls back to a floating video or the in-app dock, so PiP behaviour is
 * never lost, only less native.
 */

interface DocumentPictureInPicture {
  requestWindow(options?: {
    width?: number;
    height?: number;
    disallowReturnToOpener?: boolean;
  }): Promise<Window>;
  window: Window | null;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

export function isDocumentPipSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.documentPictureInPicture?.requestWindow === "function"
  );
}

/** Opens a Document PiP window, or `null` when the API is unavailable/denied. */
export async function openDocumentPip(width: number, height: number): Promise<Window | null> {
  const api = typeof window === "undefined" ? undefined : window.documentPictureInPicture;
  if (api === undefined || typeof api.requestWindow !== "function") {
    return null;
  }
  try {
    const pipWindow = await api.requestWindow({ width, height, disallowReturnToOpener: false });
    copyStylesInto(pipWindow);
    return pipWindow;
  } catch {
    return null;
  }
}

/**
 * Copies the opener's stylesheets, adopted styles and CSS variables into the
 * PiP document so a portal rendered there looks identical to the main window.
 */
export function copyStylesInto(target: Window): void {
  const source = document;
  for (const sheet of Array.from(source.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join("\n");
      const style = target.document.createElement("style");
      style.textContent = css;
      target.document.head.appendChild(style);
    } catch {
      // Cross-origin sheet: re-link it instead.
      const owner = sheet.ownerNode;
      if (owner instanceof HTMLLinkElement) {
        const link = target.document.createElement("link");
        link.rel = "stylesheet";
        link.href = owner.href;
        target.document.head.appendChild(link);
      }
    }
  }
  // Carry the theme class and variables across.
  target.document.documentElement.className = source.documentElement.className;
  const computed = getComputedStyle(source.documentElement);
  for (const name of Array.from(computed)) {
    if (name.startsWith("--aulora-")) {
      target.document.documentElement.style.setProperty(name, computed.getPropertyValue(name));
    }
  }
  target.document.documentElement.style.background = "var(--aulora-bg)";
  target.document.body.style.margin = "0";
}
