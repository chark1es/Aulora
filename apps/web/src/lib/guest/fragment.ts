import { GUEST_CALL_PATH, GUEST_LINK_TOKEN_PREFIX, isWellFormedGuestToken } from "@aulora/core";

/**
 * Reads the link token out of a URL fragment (`#agu_...`). Returns `null` for
 * anything that is not exactly one well-formed token, so a mangled or hostile
 * fragment is treated like no link at all and nothing is sent to the server.
 * The shape check is the same one the server applies (`@aulora/core`), so the
 * page and the backend cannot disagree about what a link looks like.
 */
export function parseGuestFragment(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  return isWellFormedGuestToken(raw, GUEST_LINK_TOKEN_PREFIX) ? raw : null;
}

/** True when a path is the guest page, with or without a trailing slash. */
export function isGuestCallPath(pathname: string): boolean {
  return pathname === GUEST_CALL_PATH || pathname === `${GUEST_CALL_PATH}/`;
}

/**
 * The address-bar value to leave behind once the token is in memory: path and
 * query only, never the fragment.
 */
export function strippedLocation(location: {
  readonly pathname: string;
  readonly search: string;
}): string {
  return `${location.pathname}${location.search}`;
}
