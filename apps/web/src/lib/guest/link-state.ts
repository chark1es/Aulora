import {
  GUEST_LINK_DEFAULT_MAX_USES,
  GUEST_LINK_DEFAULT_TTL_MS,
  GUEST_LINK_MAX_TTL_MS,
  GUEST_LINK_MAX_USES,
} from "@aulora/core";

/** How a guest link stands, derived from the fields `guestCalls.links` returns. */
export type GuestLinkState = "active" | "revoked" | "expired" | "used-up";

export interface GuestLinkRow {
  readonly expiresAt: number;
  readonly maxUses: number;
  readonly uses: number;
  readonly revoked: boolean;
}

/** Revocation wins, then expiry, then exhaustion; otherwise the link still works. */
export function guestLinkState(link: GuestLinkRow, now: number): GuestLinkState {
  if (link.revoked) {
    return "revoked";
  }
  if (link.expiresAt <= now) {
    return "expired";
  }
  if (link.uses >= link.maxUses) {
    return "used-up";
  }
  return "active";
}

export const GUEST_LINK_STATE_LABEL: Record<GuestLinkState, string> = {
  active: "Active",
  revoked: "Revoked",
  expired: "Expired",
  "used-up": "Used up",
};

export interface ExpiryOption {
  readonly value: string;
  readonly label: string;
  readonly ms: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The lifetimes offered in the invite dialog; the server clamps to 1 minute..7 days. */
export const GUEST_LINK_EXPIRY_OPTIONS: readonly ExpiryOption[] = [
  { value: "15m", label: "15 minutes", ms: 15 * MINUTE },
  { value: "1h", label: "1 hour", ms: GUEST_LINK_DEFAULT_TTL_MS },
  { value: "4h", label: "4 hours", ms: 4 * HOUR },
  { value: "24h", label: "24 hours", ms: DAY },
  { value: "7d", label: "7 days", ms: GUEST_LINK_MAX_TTL_MS },
];

export const DEFAULT_EXPIRY_VALUE = "1h";

/** Parses the "people allowed in" field; `null` when it is not a whole number in range. */
export function parseMaxUses(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d{1,3}$/u.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return value >= 1 && value <= GUEST_LINK_MAX_USES ? value : null;
}

export const DEFAULT_MAX_USES_TEXT = String(GUEST_LINK_DEFAULT_MAX_USES);

/** What the invite dialog knows about the call its links belong to. */
export interface LinkListTarget {
  readonly channelId?: string | undefined;
  readonly scheduledCallId?: string | undefined;
}

/** The arguments of `guestCalls.links`: exactly one of a live call or a scheduled call. */
export type LinksQueryArgs = { readonly callId: string } | { readonly scheduledCallId: string };

/**
 * Which `guestCalls.links` query to subscribe to, or `"skip"`.
 *
 * - A scheduled call is listed by its own id, so links can be listed, checked
 *   and revoked before the call has started (there is no live call id yet) and
 *   the same list is shown once it has.
 * - A channel call is listed by its live call id, and only once the server has
 *   said this member may manage the lobby, so an ordinary participant never
 *   provokes a permission error.
 */
export function linksQueryArgs(
  target: LinkListTarget,
  callId: string | null,
  canManage: boolean | undefined,
): LinksQueryArgs | "skip" {
  if (target.scheduledCallId !== undefined && target.scheduledCallId.length > 0) {
    return { scheduledCallId: target.scheduledCallId };
  }
  if (callId !== null && canManage === true) {
    return { callId };
  }
  return "skip";
}

/** Whether the "Links for this call" section is shown at all. */
export function showsLinkList(
  target: LinkListTarget,
  callId: string | null,
  canManage: boolean | undefined,
): boolean {
  return linksQueryArgs(target, callId, canManage) !== "skip";
}
