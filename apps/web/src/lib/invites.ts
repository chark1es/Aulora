/** Builds the shareable invite URL for a plaintext code. */
export function inviteUrl(origin: string, code: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/invite/${encodeURIComponent(code)}`;
}

/** Extracts and sanitizes an invite code from a route param. */
export function parseInviteCode(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Maps a redeem failure to a friendly, non-leaky message. */
export function redeemErrorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return "That invite could not be redeemed.";
}
