/**
 * Invite helpers shared by the Convex backend and every client: how a typed
 * code is normalised before hashing, how a short code is displayed, how an
 * email address is compared and how an allowlist entry matches an account.
 */

/** How an invite reaches the person it is for. */
export type InviteKind = "link" | "email" | "code";

export const INVITE_KINDS: readonly InviteKind[] = ["link", "email", "code"];

/** Lowercase hex tokens minted for links and emails: 24 random bytes. */
const LINK_TOKEN_PATTERN = /^[0-9a-f]{48}$/i;

/** Crockford base32 without I, L, O and U, so a code survives being read aloud. */
export const INVITE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Characters in a typed access code (60 bits). */
export const INVITE_CODE_LENGTH = 12;

/**
 * Canonical form of anything a person pastes or types as an invite code: the
 * full link or a bare code, any case, with or without dashes and spaces.
 * Link tokens are lowercase hex; access codes are uppercase Crockford. The
 * hash stored on the invite is taken over this form.
 */
export function normalizeInviteCode(input: string): string {
  const fromLink = /\/invite\/([^/?#\s]+)/i.exec(input)?.[1];
  const raw = (fromLink !== undefined ? safeDecode(fromLink) : input).replace(/[\s-]+/g, "");
  if (LINK_TOKEN_PATTERN.test(raw)) {
    return raw.toLowerCase();
  }
  return raw.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Whether `code` is shaped like an access code, ignoring dashes and case. */
export function isAccessCodeShape(code: string): boolean {
  const normalized = normalizeInviteCode(code);
  return (
    normalized.length === INVITE_CODE_LENGTH &&
    [...normalized].every((char) => INVITE_CODE_ALPHABET.includes(char))
  );
}

/** `ABCD-EFGH-JKMN` for display; anything that is not an access code is returned unchanged. */
export function formatAccessCode(code: string): string {
  if (!isAccessCodeShape(code)) {
    return code;
  }
  const normalized = normalizeInviteCode(code);
  return [normalized.slice(0, 4), normalized.slice(4, 8), normalized.slice(8)].join("-");
}

/** Lowercased, trimmed address used for every email comparison. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Deliberately permissive: a single `@`, a dot in the domain, no spaces. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

/** `j***@example.com`: enough to recognise the account without disclosing it. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = normalizeEmail(email).split("@");
  if (domain.length === 0) {
    return "***";
  }
  return `${local.slice(0, 1)}***@${domain}`;
}

const DOMAIN_ENTRY_PATTERN = /^@[^\s@]+\.[^\s@]+$/;

/**
 * Validates and normalises an allowlist entry. `person@example.com` admits one
 * address; `@example.com` admits everyone at that domain. Returns `null` for
 * anything else.
 */
export function parseAllowlistEntry(
  input: string,
): { readonly pattern: string; readonly kind: "email" | "domain" } | null {
  const pattern = normalizeEmail(input);
  if (DOMAIN_ENTRY_PATTERN.test(pattern)) {
    return { pattern, kind: "domain" };
  }
  if (isValidEmail(pattern)) {
    return { pattern, kind: "email" };
  }
  return null;
}

/** Whether `email` is admitted by any normalised allowlist `patterns`. */
export function allowlistAdmits(patterns: readonly string[], email: string | null | undefined) {
  if (email === undefined || email === null) {
    return false;
  }
  const address = normalizeEmail(email);
  const domain = address.slice(address.lastIndexOf("@"));
  return patterns.some((pattern) => pattern === address || pattern === domain);
}

/** What `invites.redeem` reports back: a join, or a refusal with the server's reason. */
export type RedeemOutcome =
  | { readonly joined: true; readonly alreadyMember: boolean }
  | { readonly joined: false; readonly message: string };

/** The line shown to a person once a redeem returns. */
export function redeemOutcomeMessage(outcome: RedeemOutcome): string {
  if (!outcome.joined) {
    return outcome.message.length > 0 ? outcome.message : "That invite could not be redeemed.";
  }
  return outcome.alreadyMember ? "You are already a member." : "Welcome aboard.";
}

const JOIN_CODE_FAILURES = new Map<string, string>([
  ["wrong_code", "That code is not right. Check it and try again."],
  ["expired", "That code has expired. Request a new one."],
  ["too_many_attempts", "Too many wrong tries. Request a new code."],
  ["no_code", "Request a code first."],
  ["not_allowed", "This address is no longer on the allowlist."],
]);

/** Why an emailed join code was refused, in words for the person typing it. */
export function joinCodeFailureMessage(reason: string): string {
  return JOIN_CODE_FAILURES.get(reason) ?? "That code did not work.";
}
