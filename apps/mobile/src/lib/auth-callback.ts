import { AUTH_COOKIE_KEY, type CookieStore, storeRedirectCookie } from "./cookie-fetch";

/**
 * Percent-decodes the `cookie` query parameter of a native sign-in redirect.
 *
 * `decodeURIComponent` throws `URIError` on a malformed escape (`%`, `%ZZ`) and
 * the parameter can legitimately contain a raw `%` when the deep link was
 * typed, truncated or re-encoded by a browser. The cookie is used verbatim
 * when decoding would not be lossless, so a broken escape can never reject the
 * callback handler.
 */
export function decodeAuthCookieParam(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0) {
    return null;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export interface AuthCallbackInput {
  /** The `cookie` query parameter from the deep link, when it is present. */
  readonly cookie: string | undefined;
  /** Reads the launch URL, used when the parameter is absent. */
  readonly initialUrl: () => Promise<string | null>;
}

/**
 * Persists the session cookie carried by a native auth redirect.
 *
 * Never rejects. The caller's only job afterwards is to leave the callback
 * screen, and a storage or link-read failure that rejected here would strand
 * the app on "Completing sign-in…" forever with no way back.
 */
export async function completeAuthCallback(
  store: CookieStore,
  input: AuthCallbackInput,
): Promise<boolean> {
  try {
    if (input.cookie !== undefined) {
      const cookie = decodeAuthCookieParam(input.cookie);
      if (cookie !== null) {
        await store.setItem(AUTH_COOKIE_KEY, cookie);
        return true;
      }
    }
    const url = await input.initialUrl();
    if (url === null) {
      return false;
    }
    return await storeRedirectCookie(store, url);
  } catch {
    return false;
  }
}
