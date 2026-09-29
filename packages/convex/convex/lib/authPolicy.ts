/**
 * Signup authorization shared by the Better Auth `user.create` hooks. Kept as
 * pure functions so the policy can be unit-tested without the auth component.
 */

export interface SignupPolicy {
  readonly signupEnabled: boolean;
  readonly inviteOnly: boolean;
  readonly allowedEmailDomains: readonly string[];
}

export const DEFAULT_SIGNUP_POLICY: SignupPolicy = {
  signupEnabled: true,
  inviteOnly: true,
  allowedEmailDomains: [],
};

function normalizeDomain(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

/** True when `allowed` is empty, or the email's domain is in the allow list. */
export function emailDomainAllowed(
  email: string | null | undefined,
  allowed: readonly string[],
): boolean {
  if (allowed.length === 0) {
    return true;
  }
  const domain = email?.split("@")[1]?.trim().toLowerCase();
  if (domain === undefined || domain.length === 0) {
    return false;
  }
  return allowed.some((entry) => normalizeDomain(entry) === domain);
}

/**
 * Whether account creation should be rejected outright. Invite-only still
 * allows account creation (the invitation is redeemed afterwards); only a
 * disabled signup blocks it.
 */
export function signupBlocked(policy: SignupPolicy, email: string | null | undefined): boolean {
  if (!policy.signupEnabled) {
    return true;
  }
  return !emailDomainAllowed(email, policy.allowedEmailDomains);
}

/** Roles are auto-attached on account creation only when not invite-only. */
export function shouldAutoAttachRoles(policy: SignupPolicy): boolean {
  return !policy.inviteOnly;
}
