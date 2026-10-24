/**
 * Plain-language versions of the Better Auth errors a person can actually hit
 * when the same email is used with two sign-in methods. Anything else passes
 * through unchanged, because the server's own message is already specific.
 */
const EXISTING_ACCOUNT =
  "An account already exists for this email. Sign in with the method you used first, or reset your password.";
const NOT_LINKED =
  "This email belongs to an account that uses a different sign-in method, and the provider did not confirm the address. Sign in the way you first did.";

export function describeAuthError(message: string): string {
  const normalized = message.toLowerCase().replaceAll("_", " ");
  if (normalized.includes("user already exists")) {
    return EXISTING_ACCOUNT;
  }
  if (normalized.includes("account not linked")) {
    return NOT_LINKED;
  }
  return message;
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
