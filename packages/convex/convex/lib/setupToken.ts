import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import { constantTimeEqual, sha256Hex } from "./crypto";

/** How long a printed first-run setup token stays valid. */
export const SETUP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Defensive bound for duplicate `setupClaims` rows left by a race. */
export const MAX_SETUP_CLAIM_ROWS = 8;

interface SetupClaimRow {
  readonly _id: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly tokenHash: string;
}

/**
 * Picks the one authoritative setup-claim row: oldest first, then by id so
 * every concurrent caller agrees on the same winner. Duplicate rows can only
 * appear if two first-run setup containers race; they are cleaned up on the
 * next setup call.
 */
export function canonicalSetupClaim<T extends SetupClaimRow>(rows: readonly T[]): T | null {
  let winner: T | null = null;
  for (const row of rows) {
    if (
      winner === null ||
      row.createdAt < winner.createdAt ||
      (row.createdAt === winner.createdAt && row._id < winner._id)
    ) {
      winner = row;
    }
  }
  return winner;
}

export type SetupClaimFailure = "missing" | "expired" | "invalid";

export type SetupClaimVerification =
  | { readonly ok: true; readonly source: "environment" | "stored" }
  | { readonly ok: false; readonly reason: SetupClaimFailure };

/**
 * Verifies a first-run claim proof.
 *
 * The deployment environment's `SETUP_TOKEN` is an optional operator override
 * for automated deployments. Otherwise the token printed once by the setup
 * container is checked against the SHA-256 digest stored in `setupClaims`;
 * the plaintext token is never stored.
 */
export async function verifySetupClaim(
  ctx: QueryCtx,
  provided: string,
): Promise<SetupClaimVerification> {
  if (provided.length === 0) {
    return { ok: false, reason: "missing" };
  }
  const environmentToken = process.env.SETUP_TOKEN?.trim();
  if (environmentToken !== undefined && environmentToken.length > 0) {
    return constantTimeEqual(provided, environmentToken)
      ? { ok: true, source: "environment" }
      : { ok: false, reason: "invalid" };
  }
  const row = canonicalSetupClaim(await ctx.db.query("setupClaims").take(MAX_SETUP_CLAIM_ROWS));
  if (row === null) {
    return { ok: false, reason: "missing" };
  }
  if (row.expiresAt <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  const digest = await sha256Hex(provided);
  return constantTimeEqual(digest, row.tokenHash)
    ? { ok: true, source: "stored" }
    : { ok: false, reason: "invalid" };
}

/** The client-facing error for a rejected claim. Never includes the token. */
export function setupClaimError(reason: SetupClaimFailure): ConvexError<string> {
  switch (reason) {
    case "expired":
      return new ConvexError(
        "The setup token has expired. Re-run the setup container to print a new one.",
      );
    case "missing":
      return new ConvexError(
        "Setup is not waiting for a token. Re-run the setup container to generate one.",
      );
    default:
      return new ConvexError("Invalid setup token");
  }
}
