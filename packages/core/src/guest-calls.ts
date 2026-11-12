/**
 * Shared constants for guest call links and lobby sessions.
 *
 * The plaintext link and session tokens exist only in the guest's browser: the
 * server stores SHA-256 digests. Nothing here is a secret.
 */

/** Prefix of the one-time link token (`agu_` + 64 lowercase hex chars). */
export const GUEST_LINK_TOKEN_PREFIX = "agu_";
/** Prefix of the per-guest session token (`ags_` + 64 lowercase hex chars). */
export const GUEST_SESSION_TOKEN_PREFIX = "ags_";
/** Random bytes behind either token (256 bits). */
export const GUEST_TOKEN_BYTES = 32;

/** Accepted length of a token body (after the prefix); the server mints 64 hex chars. */
const GUEST_TOKEN_BODY_MIN = 32;
const GUEST_TOKEN_BODY_MAX = 128;
const GUEST_TOKEN_BODY = /^[A-Za-z0-9_-]+$/u;

/**
 * Cheap shape check shared by the server and the guest page, so the two can
 * never disagree about what a token looks like. It authenticates nothing: the
 * server still looks up the SHA-256 digest.
 */
export function isWellFormedGuestToken(token: string, prefix: string): boolean {
  if (!token.startsWith(prefix)) {
    return false;
  }
  const body = token.slice(prefix.length);
  return (
    body.length >= GUEST_TOKEN_BODY_MIN &&
    body.length <= GUEST_TOKEN_BODY_MAX &&
    GUEST_TOKEN_BODY.test(body)
  );
}

/** A link lives one hour by default and never longer than seven days. */
export const GUEST_LINK_DEFAULT_TTL_MS = 60 * 60 * 1000;
export const GUEST_LINK_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Grace after a linked scheduled call ends before its link must expire. */
export const GUEST_LINK_SCHEDULED_GRACE_MS = 10 * 60 * 1000;

export const GUEST_LINK_DEFAULT_MAX_USES = 5;
export const GUEST_LINK_MAX_USES = 25;

/** Active links a single member may hold per call. */
export const GUEST_MAX_LINKS_PER_CREATOR_PER_CALL = 5;
/** Active links one call may have at once. */
export const GUEST_MAX_LINKS_PER_CALL = 20;

/** Maximum admitted guests in one call (also bounded by `MAX_CALL_SEATS`). */
export const GUEST_MAX_PER_CALL = 8;
/** Pending lobby requests a link may accumulate. */
export const GUEST_MAX_PENDING_PER_LINK = 10;
/** How long an unanswered lobby request stays pending. */
export const GUEST_PENDING_TTL_MS = 10 * 60 * 1000;
/** Longest an admitted guest session lasts, regardless of the call. */
export const GUEST_SESSION_MAX_TTL_MS = 4 * 60 * 60 * 1000;

/** Guest-supplied identity limits. */
export const GUEST_NAME_MAX = 40;
export const GUEST_AFFILIATION_MAX = 60;

/** Link labels are operator-facing only and never shown to the guest. */
export const GUEST_LINK_LABEL_MAX = 60;

/** Max signal ids a guest may acknowledge in one mutation. */
export const GUEST_SIGNAL_ACK_MAX = 32;

/** The one error every unusable link returns, so links cannot be probed. */
export const GUEST_LINK_GENERIC_ERROR = "This guest link is not available";

/** Link URL fragment path; the token never reaches the server in a request. */
export const GUEST_CALL_PATH = "/call/guest";

/**
 * Normalises a guest display name or affiliation: Unicode NFKC, control and
 * bidirectional-override characters removed, whitespace collapsed and trimmed.
 * Returns an empty string when nothing remains.
 */
export function normalizeGuestText(value: string): string {
  let result = "";
  const normalized = value.normalize("NFKC");
  for (const character of normalized) {
    const code = character.codePointAt(0) ?? 0;
    // C0/C1 controls and the Unicode bidirectional embedding/override range.
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      result += " ";
      continue;
    }
    if (code >= 0x202a && code <= 0x202e) {
      continue;
    }
    if (code >= 0x2066 && code <= 0x2069) {
      continue;
    }
    if (code === 0x200b || code === 0x200c || code === 0x200d || code === 0xfeff) {
      result += " ";
      continue;
    }
    result += character;
  }
  return result.replace(/\s+/gu, " ").trim();
}

/** Builds the shareable link shown once at creation. */
export function guestLinkUrl(siteUrl: string, token: string): string {
  const origin = siteUrl.replace(/\/+$/, "");
  return `${origin}${GUEST_CALL_PATH}#${token}`;
}
