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
  return combined
    .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export interface CookieFetchOptions {
  readonly store: CookieStore;
  readonly baseFetch?: typeof fetch;
}

/** Wraps `fetch` so the Better Auth session cookie survives across requests. */
export function createCookieFetch(options: CookieFetchOptions): typeof fetch {
  const baseFetch = options.baseFetch ?? globalThis.fetch;
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const stored = await options.store.getItem(AUTH_COOKIE_KEY);
    const headers = new Headers(init?.headers);
    if (stored !== null && stored.length > 0 && !headers.has("cookie")) {
      headers.set("cookie", stored);
    }
    const response = await baseFetch(input, { ...init, headers });
    const setCookies = readSetCookies(response.headers);
    if (setCookies.length > 0) {
      const merged = mergeCookieHeader(stored, setCookies);
      if (merged.length > 0) {
        await options.store.setItem(AUTH_COOKIE_KEY, merged);
      } else {
        await options.store.removeItem(AUTH_COOKIE_KEY);
      }
    }
    return response;
  };
}

/** Stores the `cookie` query parameter Better Auth appends to a native redirect. */
export async function storeRedirectCookie(store: CookieStore, url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const cookie = parsed.searchParams.get("cookie");
  if (cookie === null || cookie.length === 0) {
    return false;
  }
  const merged = mergeCookieHeader(await store.getItem(AUTH_COOKIE_KEY), [cookie]);
  if (merged.length > 0) {
    await store.setItem(AUTH_COOKIE_KEY, merged);
    return true;
  }
  return false;
}
