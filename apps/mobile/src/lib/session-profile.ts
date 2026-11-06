import type { ServerProfile } from "@aulora/core";

/** A stored profile URL the clients refuse to use. */
export type ProfileUrlField = "baseUrl" | "convexUrl" | "siteUrl";

/**
 * True when `value` is an absolute `http(s)` URL with a host.
 *
 * Deliberately looser than `normalizeServerUrl`: that rejects public `http://`
 * on purpose, while a server is free to advertise its own (insecure) Convex
 * address and the clients will use it. What matters here is only that the
 * address parses, because `ConvexReactClient` throws on anything else and
 * Better Auth cannot call a relative base URL.
 */
export function isAbsoluteServerUrl(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * The stored URL that makes a profile unusable, or `null` when all of them parse.
 *
 * `/.well-known/aulora.json` only promises `convexUrl` and `siteUrl` are
 * non-empty strings, and a stored profile is re-read from disk on every launch,
 * so a server advertising a scheme-less `convexUrl` (or a hand-edited profile)
 * reaches the client intact. Checking before the clients are constructed turns
 * a render-time throw that the route boundary can only retry forever into a
 * screen the person can act on.
 */
export function profileUrlProblem(
  profile: Pick<ServerProfile, "baseUrl" | "convexUrl" | "siteUrl">,
): ProfileUrlField | null {
  if (!isAbsoluteServerUrl(profile.baseUrl)) {
    return "baseUrl";
  }
  if (!isAbsoluteServerUrl(profile.convexUrl)) {
    return "convexUrl";
  }
  if (!isAbsoluteServerUrl(profile.siteUrl)) {
    return "siteUrl";
  }
  return null;
}
