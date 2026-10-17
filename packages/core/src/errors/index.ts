/**
 * Classification for errors thrown while a client renders or subscribes to a
 * Convex query. Convex re-sends a query's subscription after a reconnect or an
 * auth refresh, so a transient failure should not tear the UI down; only a
 * genuine rejection needs the person to act.
 */

import { isConnectivityError } from "../outbox/index.js";

/**
 * How a client should react to a thrown error:
 *
 * - `reconnecting`: the failure is transient — a dropped connection, or the
 *   caller briefly reading as unauthenticated while the session or Convex token
 *   is being refreshed. Keep the person's place and recover once the connection
 *   or auth comes back.
 * - `fatal`: anything else (a validation or permission rejection). The view
 *   needs an explicit retry.
 */
export type ErrorDisposition = "reconnecting" | "fatal";

/**
 * Substrings that mark an authentication failure. Convex surfaces a server
 * `requireAuth` rejection as `Uncaught ConvexError: Not authenticated`; the
 * session cookie or Convex token is usually re-sent after a reconnect, so this
 * is treated as transient rather than a sign-out.
 */
const AUTH_ERROR_PATTERNS = ["not authenticated", "unauthenticated", "no auth"] as const;

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error === null || error === undefined) {
    return "";
  }
  return String(error);
}

/** Whether an error says the caller was (momentarily) not authenticated. */
export function isAuthenticationError(error: unknown): boolean {
  const message = messageOf(error).toLowerCase();
  return AUTH_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

/** Classifies a thrown error for the recovery boundary. */
export function classifyError(error: unknown): ErrorDisposition {
  if (isConnectivityError(error) || isAuthenticationError(error)) {
    return "reconnecting";
  }
  return "fatal";
}
