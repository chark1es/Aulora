import { NATIVE_AUTH_EXPIRED_ERROR } from "@aulora/core";

/**
 * Plain-language versions of the Better Auth errors a person can actually hit
 * when the same email is used with two sign-in methods. A message that is not
 * one of the known auth codes never reaches the screen verbatim: the handoff
 * route already allowlists its error codes, and this is the client-side second
 * line of defence for an older or compromised server.
 */
const EXISTING_ACCOUNT =
  "An account already exists for this email. Sign in with the method you used first, or reset your password.";
const NOT_LINKED =
  "This email belongs to an account that uses a different sign-in method, and the provider did not confirm the address. Sign in the way you first did.";
const STATE_MISMATCH = "Sign-in expired before it finished. Start again from this screen.";
const EXPIRED = "Sign-in took too long, please try again.";
const CANCELLED = "Sign-in was cancelled. Try again.";
const PROVIDER_UNAVAILABLE = "That sign-in provider is not available right now. Try again.";
const GENERIC = "Sign-in could not be completed. Try again.";

/**
 * Whether a failed session lookup is a definitive rejection rather than an
 * outage. Better Auth answers 401 only when the credentials it was given are
 * dead; a server that is down or restarting fails without a status. So this is
 * the one answer that may drop a stored session token — a person is never
 * signed out because a request timed out.
 */
export function isInvalidSessionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }
  return error.status === 401;
}

/**
 * Validation messages Better Auth writes for the local form, safe to show. The
 * display copy is a fixed constant rather than the input: a server or a crafted
 * `?error=` value can embed one of these phrases in attacker-authored text, and
 * echoing the input would paint the rest of that text into the sign-in page.
 */
const SAFE_FORM_MESSAGES: readonly { readonly match: string; readonly message: string }[] = [
  // The client's own exchange-timeout copy (oauth-start.ts), stored for display.
  { match: "sign-in timed out", message: "Sign-in timed out, please try again" },
  { match: "invalid email or password", message: "Invalid email or password" },
  { match: "invalid email", message: "Invalid email" },
  { match: "password is too short", message: "Password is too short" },
  { match: "password too short", message: "Password too short" },
  { match: "name is required", message: "Name is required" },
  { match: "email is required", message: "Email is required" },
];

/**
 * A bounded diagnostic form of a failed auth result for the local debug log.
 *
 * The sign-in screen deliberately never echoes arbitrary server text, but the
 * report may keep the message: it stays in memory until the person exports it,
 * and `redactDebugText` scrubs URLs and credentials. Keeping the reason is what
 * turns an otherwise empty "sign-in failed" report into something actionable.
 */
export function authFailureDetail(error: unknown): string {
  const MAX = 500;
  if (typeof error === "string") {
    return error.slice(0, MAX);
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, MAX);
  }
  if (typeof error === "object" && error !== null) {
    const record = error as { readonly message?: unknown; readonly status?: unknown };
    const parts: string[] = [];
    if (typeof record.status === "number") {
      parts.push(`status ${record.status}`);
    }
    if (typeof record.message === "string" && record.message.length > 0) {
      parts.push(record.message);
    }
    if (parts.length > 0) {
      return parts.join(": ").slice(0, MAX);
    }
  }
  return "Auth request failed without a message";
}

export function describeAuthError(message: string): string {
  const normalized = message.toLowerCase().replaceAll("_", " ");
  if (normalized.includes("user already exists")) {
    return EXISTING_ACCOUNT;
  }
  if (normalized.includes("account not linked")) {
    return NOT_LINKED;
  }
  if (normalized.includes("state mismatch")) {
    return STATE_MISMATCH;
  }
  if (normalized === NATIVE_AUTH_EXPIRED_ERROR.replaceAll("_", " ")) {
    return EXPIRED;
  }
  if (normalized.includes("auth cancelled") || normalized.includes("auth canceled")) {
    return CANCELLED;
  }
  if (normalized.includes("provider unavailable") || normalized.includes("invalid provider")) {
    return PROVIDER_UNAVAILABLE;
  }
  const safe = SAFE_FORM_MESSAGES.find((entry) => normalized.includes(entry.match));
  if (safe !== undefined) {
    return safe.message;
  }
  return GENERIC;
}

/**
 * Reads the `?error=` code Better Auth adds when an OAuth sign-in fails and
 * sends the browser back, then removes it from the address bar so a reload does
 * not show a stale error. Returns `null` when there is none.
 */
export function takeAuthErrorFromUrl(href: string = window.location.href): string | null {
  const url = new URL(href);
  const code = url.searchParams.get("error");
  if (code === null || code.length === 0) {
    return null;
  }
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  window.history.replaceState(window.history.state, "", url.toString());
  return describeAuthError(code);
}
