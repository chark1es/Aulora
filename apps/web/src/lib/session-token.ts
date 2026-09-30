/**
 * Persisted session token for clients that are not served from the server's own
 * origin (the desktop app loads from `tauri://localhost`, and a dev build may
 * run on another port). Browsers refuse to keep a cross-site session cookie
 * across restarts, so the server hands the token back in `set-auth-token` and
 * the client stores it and replays it as a bearer token.
 *
 * When the app *is* served from the server's origin the HttpOnly session cookie
 * does the job and nothing is stored here.
 */

const TOKEN_KEY_PREFIX = "aulora.session.v1:";

export interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): TokenStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function tokenKey(siteUrl: string): string {
  try {
    return `${TOKEN_KEY_PREFIX}${new URL(siteUrl).origin}`;
  } catch {
    return `${TOKEN_KEY_PREFIX}${siteUrl}`;
  }
}

/** True when `siteUrl` is a different origin from the page running the app. */
export function isCrossOrigin(siteUrl: string, pageOrigin?: string): boolean {
  const current =
    pageOrigin ?? (typeof window === "undefined" ? undefined : window.location.origin);
  if (current === undefined) {
    return false;
  }
  try {
    return new URL(siteUrl).origin !== current;
  } catch {
    return false;
  }
}

export function readSessionToken(
  siteUrl: string,
  storage: TokenStorage | null = defaultStorage(),
): string | null {
  return storage?.getItem(tokenKey(siteUrl)) ?? null;
}

export function writeSessionToken(
  siteUrl: string,
  token: string,
  storage: TokenStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(tokenKey(siteUrl), token);
  } catch {
    // Storage full or blocked: the session then lasts until the app closes.
  }
}

export function clearSessionToken(
  siteUrl: string,
  storage: TokenStorage | null = defaultStorage(),
): void {
  try {
    storage?.removeItem(tokenKey(siteUrl));
  } catch {
    // Nothing to clear.
  }
}
