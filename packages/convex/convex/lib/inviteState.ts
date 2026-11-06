/** Why an invite can or cannot be redeemed right now. */
export type InviteStatus = "active" | "revoked" | "expired" | "exhausted";

interface InviteLifecycle {
  readonly revokedAt?: number | undefined;
  readonly expiresAt?: number | undefined;
  readonly maxUses: number;
  readonly uses: number;
}

/**
 * The single definition of an invite's state. Revocation wins over expiry, and
 * expiry over use-up, so the reason shown to a person is the most deliberate one.
 */
export function inviteStatus(invite: InviteLifecycle, now: number): InviteStatus {
  if (invite.revokedAt !== undefined) {
    return "revoked";
  }
  if (invite.expiresAt !== undefined && invite.expiresAt <= now) {
    return "expired";
  }
  if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
    return "exhausted";
  }
  return "active";
}

interface IdentifiedInvite extends InviteLifecycle {
  readonly _creationTime: number;
}

/**
 * Picks the row a typed code resolves to when several invites share a hash.
 * Custom codes may be recreated after the previous invite is revoked, expired
 * or used up, so the same hash can legitimately appear more than once. An
 * active invite always wins (newest first, should two ever be active); when
 * none is active the newest row supplies the refusal reason a person sees.
 */
export function pickInviteByCode<T extends IdentifiedInvite>(
  invites: readonly T[],
  now: number,
): T | null {
  let active: T | null = null;
  let latest: T | null = null;
  for (const invite of invites) {
    if (latest === null || invite._creationTime > latest._creationTime) {
      latest = invite;
    }
    if (inviteStatus(invite, now) === "active") {
      if (active === null || invite._creationTime > active._creationTime) {
        active = invite;
      }
    }
  }
  return active ?? latest;
}
