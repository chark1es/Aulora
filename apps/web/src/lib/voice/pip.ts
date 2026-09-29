/**
 * Document Picture-in-Picture support (desktop Chrome/Edge, and the Tauri
 * webview where the underlying engine provides it). When unavailable the call
 * dock falls back to an in-app floating window, so PiP behaviour is never lost,
 * only less native.
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
