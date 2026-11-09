import { isGuestCallPath, parseGuestFragment, strippedLocation } from "./fragment";

/**
 * Runs before the router and every other module: on the guest page it moves the
 * link token out of the address bar and into memory, then rewrites the history
 * entry without the fragment. The token is never logged or stored.
 */
let captured: string | null = null;

if (typeof window !== "undefined" && isGuestCallPath(window.location.pathname)) {
  captured = parseGuestFragment(window.location.hash);
  try {
    window.history.replaceState(window.history.state, "", strippedLocation(window.location));
  } catch {
    // A restricted environment may refuse; the token was still read once.
  }
}

/**
 * The token read from the address bar, held in memory for this page load only.
 * It is never written to storage. Reading is repeatable so React's development
 * double-render sees the same value.
 */
export function peekGuestLinkToken(): string | null {
  return captured;
}
