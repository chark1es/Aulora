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
