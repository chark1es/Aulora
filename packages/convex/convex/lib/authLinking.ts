import type { DBAdapter } from "better-auth/adapters";
import type { Env } from "./env";

/**
 * Account linking between a local email/password account and an OAuth identity
 * (Google, GitHub, Microsoft, Apple or the generic OIDC provider).
 *
 * Better Auth 1.6.22 links an OAuth sign-in to an existing user with the same
 * email only when the provider is trusted or reports `emailVerified`, AND when
 * `accountLinking.requireLocalEmailVerified` (default `true`) finds the local
 * user verified. Aulora never verifies local addresses
 * (`emailAndPassword.requireEmailVerification: false`), so every email/password
 * user is `emailVerified: false` and every OAuth sign-in failed with
 * "account not linked". Turning `requireLocalEmailVerified` off fixes that.
 *
 * Built-in social providers are deliberately NOT listed in `trustedProviders`.
 * Better Auth treats a trusted provider's email as verified even when the
 * provider says otherwise, which would let anyone who registered a victim's
 * address with a password inherit the victim's OAuth identity. Without trust,
 * the link still happens for Google/Microsoft/Apple (they always assert a
 * verified email) and for GitHub (it reports the address as verified), but only
 * when the provider asserts `emailVerified`. There is no lever in 1.6.22 to
 * keep a provider trusted for the authenticated link flow while still
 * requiring `emailVerified` during implicit linking, so the safe gate wins.
 *
 * The generic OIDC provider usually does not report `email_verified`. It stays
 * untrusted (new OIDC sign-ins create a separate user) unless the operator sets
 * `OIDC_TRUST_EMAIL=true` to trust the IdP's claim.
 */
export const OIDC_TRUST_EMAIL_ENV = "OIDC_TRUST_EMAIL";

/** True only for the exact value `true`, so `1`/`yes` cannot enable it by accident. */
export function oidcEmailTrusted(env: Env): boolean {
  return env.OIDC_TRUST_EMAIL?.trim().toLowerCase() === "true";
}

export interface AccountLinkingSettings {
  readonly enabled: true;
  /** Provider ids whose email claim is trusted without `emailVerified`. */
  readonly trustedProviders: string[];
  /** Local users are never verified in Aulora; the provider claim is the proof. */
  readonly requireLocalEmailVerified: false;
  readonly allowDifferentEmails: false;
}

/**
 * Settings for `account.accountLinking`. `oidcProviderId` is the configured
 * generic OIDC provider id, or `null` when OIDC is not configured.
 */
export function getAccountLinkingSettings(
  env: Env,
  oidcProviderId: string | null,
): AccountLinkingSettings {
  const trustedProviders = oidcProviderId !== null && oidcEmailTrusted(env) ? [oidcProviderId] : [];
  return {
    enabled: true,
    trustedProviders,
    requireLocalEmailVerified: false,
    allowDifferentEmails: false,
  };
}

/** Millisecond timestamp of an account row, which the Convex adapter returns as a number. */
export function accountCreatedAtMs(createdAt: unknown): number | null {
  if (typeof createdAt === "number" && Number.isFinite(createdAt)) {
    return createdAt;
  }
  if (createdAt instanceof Date) {
    return createdAt.getTime();
  }
  return null;
}

type SessionStore = Pick<DBAdapter, "deleteMany" | "findOne">;

/** The fields of a new account row the revoker reads. */
export interface LinkedAccount {
  readonly userId: string;
  readonly providerId: string;
  readonly createdAt?: unknown;
}

/**
 * Whether a new account row is an OAuth identity landing on a user whose address
 * was never proven. Better Auth flips `emailVerified` to `true` only after this
 * hook, so an unverified user here is one who signed up with a password. A
 * password account itself (`credential`), a brand-new OAuth user (created
 * verified by the provider) and a deliberate link by a verified user are not.
 */
async function isUnprovenLink(store: SessionStore, account: LinkedAccount): Promise<boolean> {
  if (account.providerId === "credential") {
    return false;
  }
  const user = await store.findOne<{ emailVerified?: boolean }>({
    model: "user",
    where: [{ field: "id", value: account.userId }],
  });
  return user !== null && user.emailVerified !== true;
}

/**
 * Deletes every session the user had before the account row was created, when
 * an OAuth identity is linked to an address nobody had proven. A session issued
 * to someone who registered the address first (without owning it) must not
 * survive the owner's sign-in. Sessions created by the current request are
 * newer than the account row and stay valid. A row without a readable timestamp
 * leaves sessions untouched.
 */
export async function revokePreLinkSessions(
  store: SessionStore,
  account: LinkedAccount,
): Promise<void> {
  const before = accountCreatedAtMs(account.createdAt);
  if (before === null || !(await isUnprovenLink(store, account))) {
    return;
  }
  await store.deleteMany({
    model: "session",
    where: [
      { field: "userId", value: account.userId },
      { field: "createdAt", operator: "lt", value: before },
    ],
  });
}
