/**
 * Cookie persistence for Better Auth on React Native.
 *
 * React Native's `fetch` does not keep a cookie jar, and Better Auth's session
 * lives in an `HttpOnly` cookie. This wrapper reads any stored cookie into the
 * request and folds `set-cookie` responses back into the store. Kept free of
 * Expo imports so it is unit-testable on any host.
 */

export interface CookieStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const AUTH_COOKIE_KEY = "aulora.auth.cookie";

/**
 * The bearer token key for one workspace. OAuth on a phone finishes in a
 * browser that has its own cookie jar, so the session comes back as a token
 * instead of a cookie; the same key also receives `set-auth-token` refreshes
 * from Better Auth's bearer plugin.
 */
export function authTokenKey(siteUrl: string): string {
  try {
    return `aulora.auth.token:${new URL(siteUrl).origin}`;
  } catch {
    return `aulora.auth.token:${siteUrl}`;
  }
}

function parseCookies(header: string): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name.length > 0) {
      cookies.set(name, value);
    }
  }
  return cookies;
}

/**
 * Reads only the leading `name=value` of a `set-cookie` header, ignoring the
 * `Path`, `HttpOnly`, `Expires` and other attributes that follow.
 */
function firstCookiePair(header: string): [string, string] | null {
  const pair = header.split(";")[0] ?? "";
  const eq = pair.indexOf("=");
  if (eq <= 0) {
    return null;
  }
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  return name.length > 0 ? [name, value] : null;
}

/** Merges `set-cookie` headers into a cookie header string. */
export function mergeCookieHeader(
  current: string | null,
  setCookieHeaders: readonly string[],
): string {
  const cookies = current !== null ? parseCookies(current) : new Map<string, string>();
  for (const header of setCookieHeaders) {
    const pair = firstCookiePair(header);
    if (pair === null) {
      continue;
    }
    const [name, value] = pair;
    if (value.length === 0) {
      cookies.delete(name);
    } else {
      cookies.set(name, value);
    }
  }
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

/**
 * Reads every `set-cookie` header from a response. React Native exposes them
 * either through `getSetCookie()` or a single combined `get("set-cookie")`.
 */
export function readSetCookies(headers: Headers): string[] {
  const getSetCookie = (headers as { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === "function") {
    const values = getSetCookie.call(headers);
    if (Array.isArray(values) && values.length > 0) {
      return values;
    }
  }
  const combined = headers.get("set-cookie");
  if (combined === null || combined.length === 0) {
    return [];
  }
  // Split multiple cookies that were joined with a comma before an attribute.
  // A cookie name is an HTTP token, so it may contain `.`, `+` and similar
  // (Better Auth uses `better-auth.session_token`).
  return combined
    .split(/,(?=\s*[!#$%&'*+\-.^_`|~A-Za-z0-9]+=)/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export interface CookieFetchOptions {
  readonly store: CookieStore;
  readonly baseFetch?: typeof fetch;
  /** Reads and refreshes the workspace's bearer token, when OAuth set one. */
  readonly tokenKey?: string;
}

/**
 * The origin a native auth request is made from.
 *
 * React Native's `fetch` sends neither `Origin` nor `Referer`. Better Auth's
 * CSRF check rejects a cookie-bearing non-GET request with
 * "Missing or null Origin" (`MISSING_OR_NULL_ORIGIN`), which made sign-out fail
 * on the phone even though the session cookie was valid. A native app is not a
 * browser: it holds the cookie in its own storage, so there is no ambient
 * browser credential to protect. Naming the workspace origin is truthful and
 * the backend still checks it against `trustedOrigins`; this does not disable or
 * weaken that check for browsers.
 *
 * Only absolute http(s) URLs are eligible. `Origin` must be a bare origin, and
 * Better Auth compares it with the trusted list exactly.
 */
export function requestOrigin(input: RequestInfo | URL): string | null {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : typeof (input as { url?: unknown }).url === "string"
          ? (input as { url: string }).url
          : null;
  if (url === null) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin === "null" ? null : parsed.origin;
  } catch {
    return null;
  }
}

/** Wraps `fetch` so the Better Auth session survives across requests. */
export function createCookieFetch(options: CookieFetchOptions): typeof fetch {
  const baseFetch = options.baseFetch ?? globalThis.fetch;
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const stored = await options.store.getItem(AUTH_COOKIE_KEY);
    const headers = new Headers(init?.headers);
    if (stored !== null && stored.length > 0 && !headers.has("cookie")) {
      headers.set("cookie", stored);
    }
    // See `requestOrigin`: native auth POSTs otherwise look origin-less to
    // Better Auth and its CSRF check rejects the sign-out request. A literal
    // `Origin: null` (opaque browser origin) is just as unusable as a missing
    // one, so replace it with the workspace origin too; the backend still
    // validates that value against its trusted origins.
    const suppliedOrigin = headers.get("origin");
    if (suppliedOrigin === null || suppliedOrigin.trim().toLowerCase() === "null") {
      const origin = requestOrigin(input);
      if (origin !== null) {
        headers.set("origin", origin);
      }
    }
    if (options.tokenKey !== undefined && !headers.has("authorization")) {
      const token = await options.store.getItem(options.tokenKey);
      if (token !== null && token.length > 0) {
        headers.set("authorization", `Bearer ${token}`);
      }
    }
    // `omit` keeps the platform cookie jar out of it. With `include`, iOS adds
    // its own copy of the session cookie next to this header and the server
    // then reads no session at all.
    const response = await baseFetch(input, { ...init, headers, credentials: "omit" });
    const setCookies = readSetCookies(response.headers);
    if (setCookies.length > 0) {
      const merged = mergeCookieHeader(stored, setCookies);
      if (merged.length > 0) {
        await options.store.setItem(AUTH_COOKIE_KEY, merged);
      } else {
        await options.store.removeItem(AUTH_COOKIE_KEY);
      }
    }
    if (options.tokenKey !== undefined) {
      const refreshed = response.headers.get("set-auth-token");
      if (refreshed !== null && refreshed.length > 0) {
        await options.store.setItem(options.tokenKey, refreshed);
      }
      if (String(input).includes("/sign-out")) {
        await options.store.removeItem(options.tokenKey);
      }
    }
    return response;
  };
}
