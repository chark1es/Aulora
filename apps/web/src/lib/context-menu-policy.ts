/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
/**
 * Desktop right-click policy.
 *
 * The Tauri webview owns a native context menu that is wrong for a chat app
 * (`Reload`, `Back`, `Share`, `Save as`, `Inspect Element`). The app already
 * draws its own menus through `ContextMenuProvider`/`useContextMenu`, so this
 * module decides what a right-click means and the mounted handler
 * (`components/DesktopContextMenu.tsx`) suppresses the native menu for every
 * surface the app owns.
 *
 * The classification is deliberately small and data-only so it can be unit
 * tested without a webview:
 *
 * - editable fields (text inputs, textareas, contenteditable) keep the native
 *   menu: it carries the OS spell-checker, autocorrect, dictation and IME
 *   entries, and the web platform exposes no API for spelling suggestions.
 * - links, user-content media and live text selections get an app-styled menu.
 * - everything else is suppressed. App surfaces keep their own menus because
 *   suppression only cancels the native default; it does not stop propagation,
 *   so the component handler still runs and opens its `useContextMenu` menu.
 *
 * The native default action is cancelled while the event is still in the
 * capture phase, before any component handler. A capture listener cannot read
 * a later `preventDefault()` from a component, which is why "already handled"
 * means "an earlier capture listener cancelled it"; component menus are not
 * disturbed either way because this handler never stops propagation for the
 * suppressed case.
 */

import { publicOrigin } from "./public-origin";

export type ContextMenuMediaKind = "image" | "video" | "audio";

export type ContextMenuTarget =
  | { readonly kind: "link"; readonly href: string }
  | {
      readonly kind: "media";
      readonly media: ContextMenuMediaKind;
      readonly url: string;
      readonly name?: string;
    }
  | { readonly kind: "selection"; readonly text: string };

export type ContextMenuDecision =
  | {
      readonly action: "leave";
      readonly reason: "already-handled" | "editable" | "dev-native";
    }
  | { readonly action: "suppress"; readonly reason: "plain" }
  | { readonly action: "menu"; readonly target: ContextMenuTarget };

/** The subset of a `MouseEvent` the policy reads; keeps tests free of the DOM. */
export interface ContextMenuEventLike {
  readonly target: EventTarget | null;
  readonly defaultPrevented: boolean;
  readonly shiftKey: boolean;
  readonly clientX: number;
  readonly clientY: number;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface ContextMenuSpecItem {
  readonly id: string;
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  readonly separatorBefore?: boolean;
}

export interface ContextMenuSpec {
  readonly label: string;
  readonly items: readonly ContextMenuSpecItem[];
}

/**
 * Marks user-authored media (attachments) so its right-click menu offers
 * Open/Save/Copy. Decorative images — avatars, workspace logos, screen-share
 * thumbnails, call tiles — stay unmarked and are simply suppressed, so they
 * never pre-empt the row menu (a member row, a picker tile) with image actions.
 */
export const MEDIA_ATTRIBUTE = "data-context-menu-media";

/**
 * Marks a block whose text "Select all" should select (a message body, a note).
 * Without it the policy falls back to the nearest paragraph/code block.
 */
export const TEXT_SCOPE_ATTRIBUTE = "data-context-menu-text";

const MEDIA_SELECTOR = `img[${MEDIA_ATTRIBUTE}], video[${MEDIA_ATTRIBUTE}], audio[${MEDIA_ATTRIBUTE}]`;
const TEXT_SCOPE_SELECTOR = `[${TEXT_SCOPE_ATTRIBUTE}], p, pre, blockquote, li`;
const OPENABLE_URL = /^https?:\/\//i;
// The shell serves its own bundle and IPC from these; a link action must never
// hand them to `open_external` or the clipboard, where they only name the
// bundle's internal origin and work for nobody else.
const SHELL_SCHEME = /^(?:tauri|asset|ipc|file):/i;
const SHELL_HOSTS: Readonly<Record<string, true>> = {
  "tauri.localhost": true,
  "asset.localhost": true,
  "ipc.localhost": true,
};

const TEXT_INPUT_TYPES: Readonly<Record<string, true>> = {
  text: true,
  search: true,
  url: true,
  email: true,
  tel: true,
  password: true,
  number: true,
  date: true,
  "datetime-local": true,
  month: true,
  time: true,
  week: true,
};

const MEDIA_NOUN: Readonly<Record<ContextMenuMediaKind, string>> = {
  image: "image",
  video: "video",
  audio: "audio",
};

const MEDIA_EXTENSION: Readonly<Record<ContextMenuMediaKind, string>> = {
  image: ".png",
  video: ".mp4",
  audio: ".webm",
};

/** Narrows an event target to the element that owns the menu surface. */
export function elementFromTarget(target: EventTarget | null): Element | null {
  if (target === null) {
    return null;
  }
  if (target instanceof Element) {
    return target;
  }
  if (target instanceof Node) {
    return target.parentElement;
  }
  return null;
}

/**
 * Whether a right-click belongs to a field that should keep the native menu.
 * Non-text inputs (checkbox, range, file, button…) have no text menu, so they
 * are not treated as editable and are suppressed like the rest of the chrome.
 */
export function isEditableTarget(element: Element | null): boolean {
  if (element === null) {
    return false;
  }
  if (element instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES[element.type] === true;
  }
  if (element instanceof HTMLTextAreaElement) {
    return true;
  }
  const editable = element.closest("[contenteditable]");
  return editable !== null && editable.getAttribute("contenteditable") !== "false";
}

export function linkTarget(element: Element | null): { href: string } | null {
  const anchor = element?.closest("a[href]");
  if (anchor === null || anchor === undefined) {
    return null;
  }
  const href = anchor.getAttribute("href");
  const resolved = href === null ? null : resolveLinkHref(href);
  // The shell's `open_external` only accepts http(s); a dead "Open link" item
  // is worse than no menu, so anything else stays suppressed.
  return resolved === null ? null : { href: resolved };
}

/**
 * Whether `url` names one of the shell's own addresses. Those only resolve
 * inside this bundle, so copying or opening them produces a dead link that also
 * names the shell's internal origin.
 */
export function isShellUrl(url: string): boolean {
  if (SHELL_SCHEME.test(url)) {
    return true;
  }
  try {
    return SHELL_HOSTS[new URL(url).hostname.toLowerCase()] === true;
  } catch {
    return false;
  }
}

/**
 * The shareable absolute URL for an anchor's `href`, or `null` when it has no
 * destination worth acting on. Relative links resolve against the workspace
 * origin — never the shell's own — so a right-click on an in-app path copies a
 * URL other people can open. A relative path with no known workspace origin is
 * `null` rather than a bare fragment.
 */
export function resolveLinkHref(href: string, origin: string = publicOrigin()): string | null {
  const trimmed = href.trim();
  if (trimmed.length === 0 || isShellUrl(trimmed)) {
    return null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return OPENABLE_URL.test(trimmed) ? trimmed : null;
  }
  if (origin.length === 0) {
    return null;
  }
  try {
    const resolved = new URL(trimmed, origin);
    return OPENABLE_URL.test(resolved.href) && !isShellUrl(resolved.href) ? resolved.href : null;
  } catch {
    return null;
  }
}

export function mediaTarget(element: Element | null): ContextMenuTarget | null {
  const media = element?.closest(MEDIA_SELECTOR);
  if (media === null || media === undefined) {
    return null;
  }
  const url = media.getAttribute("src");
  if (url === null || url.length === 0) {
    return null;
  }
  const mediaKind: ContextMenuMediaKind =
    media.tagName === "VIDEO" ? "video" : media.tagName === "AUDIO" ? "audio" : "image";
  const name = media.getAttribute("alt") ?? media.getAttribute("aria-label") ?? undefined;
  return {
    kind: "media",
    media: mediaKind,
    url,
    ...(name !== undefined && name.length > 0 ? { name } : {}),
  };
}

/** The element "Select all" selects for a right-click at `element`. */
export function selectionScope(element: Element | null): Element | null {
  return element?.closest(TEXT_SCOPE_SELECTOR) ?? null;
}

/**
 * Classifies one right-click. `selectionText` is the live selection at menu
 * time (empty when collapsed), sampled by the caller so the module stays pure.
 */
export function decideContextMenu(
  event: ContextMenuEventLike,
  options: { readonly dev: boolean; readonly selectionText: string },
): ContextMenuDecision {
  if (event.defaultPrevented) {
    return { action: "leave", reason: "already-handled" };
  }
  // Development escape hatch: Shift+right-click opens the native menu, which is
  // where `Inspect Element` lives in a debug webview. Production builds have no
  // item that opens DevTools.
  if (options.dev && event.shiftKey) {
    return { action: "leave", reason: "dev-native" };
  }
  const element = elementFromTarget(event.target);
  if (isEditableTarget(element)) {
    return { action: "leave", reason: "editable" };
  }
  const media = mediaTarget(element);
  if (media !== null) {
    return { action: "menu", target: media };
  }
  const link = linkTarget(element);
  if (link !== null) {
    return { action: "menu", target: { kind: "link", href: link.href } };
  }
  if (options.selectionText.length > 0) {
    return {
      action: "menu",
      target: { kind: "selection", text: options.selectionText },
    };
  }
  return { action: "suppress", reason: "plain" };
}

export function isOpenableUrl(url: string): boolean {
  return OPENABLE_URL.test(url);
}

/** A safe file name for saving media, preferring the author's own name. */
export function mediaFileName(url: string, kind: ContextMenuMediaKind, preferred?: string): string {
  const trimmed = preferred?.trim();
  if (trimmed !== undefined && trimmed.length > 0) {
    return trimmed;
  }
  try {
    const path = new URL(url, "https://localhost/").pathname;
    const base = decodeURIComponent(path.split("/").pop() ?? "");
    // A blob/data URL path is an opaque id ("…/3f2a"), not a file name.
    if (base.includes(".") && base.length > 0) {
      return base;
    }
  } catch {
    // Fall through to the kind's default name.
  }
  return `${kind}${MEDIA_EXTENSION[kind]}`;
}

export interface ContextMenuActionDeps {
  readonly copyText: (text: string) => void;
  readonly openExternal: (url: string) => void;
  readonly saveMedia: (url: string, fileName: string) => void;
  readonly selectAll: (scope: Element | null) => void;
}

/**
 * Builds the app menu for one target. This is the single place the protocol is
 * decoded; mounting code only supplies clipboard/open/save implementations.
 */
export function buildContextMenu(
  target: ContextMenuTarget,
  deps: ContextMenuActionDeps,
  scope: Element | null,
): ContextMenuSpec {
  switch (target.kind) {
    case "link":
      return {
        label: "Link",
        items: [
          {
            id: "open-link",
            label: "Open link",
            onSelect: () => {
              deps.openExternal(target.href);
            },
          },
          {
            id: "copy-link",
            label: "Copy link address",
            onSelect: () => {
              deps.copyText(target.href);
            },
          },
        ],
      };
    case "media": {
      const noun = MEDIA_NOUN[target.media];
      const openable = isOpenableUrl(target.url);
      return {
        label: noun.charAt(0).toUpperCase() + noun.slice(1),
        items: [
          {
            id: "open-media",
            label: `Open ${noun}`,
            disabled: !openable,
            onSelect: () => {
              deps.openExternal(target.url);
            },
          },
          {
            id: "save-media",
            label: `Save ${noun} as…`,
            onSelect: () => {
              deps.saveMedia(target.url, mediaFileName(target.url, target.media, target.name));
            },
          },
          {
            id: "copy-media",
            label: `Copy ${noun} address`,
            disabled: !openable,
            separatorBefore: true,
            onSelect: () => {
              deps.copyText(target.url);
            },
          },
        ],
      };
    }
    case "selection":
      return {
        label: "Text selection",
        items: [
          {
            id: "copy-selection",
            label: "Copy",
            onSelect: () => {
              deps.copyText(target.text);
            },
          },
          {
            id: "select-all",
            label: "Select all",
            disabled: scope === null,
            onSelect: () => {
              deps.selectAll(scope);
            },
          },
        ],
      };
  }
}

export interface ContextMenuHandlerDeps extends ContextMenuActionDeps {
  readonly dev: boolean;
  /** The live selection (empty when collapsed), sampled at menu time. */
  readonly selectionText: () => string;
  readonly openMenu: (menu: {
    readonly clientX: number;
    readonly clientY: number;
    readonly label: string;
    readonly items: readonly ContextMenuSpecItem[];
  }) => void;
}

/**
 * Global handler body. Returns the decision so tests (and diagnostics) can see
 * what happened; the DOM has already been acted on.
 */
export function handleContextMenuEvent(
  event: ContextMenuEventLike,
  deps: ContextMenuHandlerDeps,
): ContextMenuDecision {
  const decision = decideContextMenu(event, {
    dev: deps.dev,
    selectionText: deps.selectionText(),
  });
  if (decision.action === "leave") {
    return decision;
  }
  // Cancel the webview's own menu for both suppressed surfaces and our menus.
  event.preventDefault();
  if (decision.action === "suppress") {
    // Keep bubbling: a component's own `onContextMenu` still opens its menu.
    return decision;
  }
  const scope = selectionScope(elementFromTarget(event.target));
  const menu = buildContextMenu(decision.target, deps, scope);
  // Our menu replaces whatever the row's handler would have opened, so stop the
  // event before the component handler runs.
  event.stopPropagation();
  deps.openMenu({
    clientX: event.clientX,
    clientY: event.clientY,
    label: menu.label,
    items: menu.items,
  });
  return decision;
}

// ---------------------------------------------------------------------------
// Browser implementations for the mounted handler.
// ---------------------------------------------------------------------------

/**
 * Copies text without throwing: the async Clipboard API first (Tauri runs on a
 * secure origin), then the legacy selection/execCommand path. Returns whether
 * anything was copied; a failed copy is silent rather than an error dialog.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard !== undefined) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path (permissions, focus, or CSP refused).
    }
  }
  const area = document.createElement("textarea");
  try {
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    area.style.top = "0";
    document.body.appendChild(area);
    area.select();
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

function downloadUrl(url: string, fileName: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** The URL when it is a plain http(s) address without credentials. */
function remoteHttpUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    const ok =
      (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.username === "";
    return ok ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Saves media locally. Attachments are object URLs, which the anchor can
 * download directly; a remote image is fetched first because a cross-origin
 * `download` attribute is ignored and would otherwise navigate the webview.
 */
export function saveMediaFile(url: string, fileName: string): void {
  if (url.startsWith("blob:") || url.startsWith("data:")) {
    downloadUrl(url, fileName);
    return;
  }
  const remote = remoteHttpUrl(url);
  if (remote === null) {
    return;
  }
  // nosemgrep -- `remote` is an http(s) URL already shown in this window (an attachment or image the person right-clicked), never typed input
  void fetch(remote)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.blob();
    })
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      try {
        downloadUrl(objectUrl, fileName);
      } finally {
        setTimeout(() => {
          URL.revokeObjectURL(objectUrl);
        }, 10_000);
      }
    })
    .catch(() => {
      // Best-effort: the server may forbid cross-origin reads.
    });
}

/** Selects the contents of the right-clicked text block. */
export function selectAllText(scope: Element | null): void {
  if (scope === null) {
    return;
  }
  const selection = document.getSelection();
  if (selection === null) {
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(scope);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** The live selection text, empty unless text is actually selected. */
export function currentSelectionText(): string {
  const selection = document.getSelection();
  if (selection === null || selection.isCollapsed) {
    return "";
  }
  return selection.toString();
}
