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

/** The one fallback every client uses when an error has no safe message. */
export const DEFAULT_ERROR_MESSAGE = "Something went wrong. Try again.";

/**
 * A message safe to show a person. Convex carries an app-authored rejection
 * (a server `ConvexError` with a string payload) through as `error.data`;
 * anything else may be an internal transport or stack message, so it is
 * replaced with `fallback`.
 */
export function userFacingError(error: unknown, fallback: string = DEFAULT_ERROR_MESSAGE): string {
  if (error instanceof Error && error.name === "ConvexError") {
    const data = (error as Error & { readonly data?: unknown }).data;
    if (typeof data === "string" && data.trim().length > 0) {
      return data;
    }
  }
  return fallback;
}

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

/** Safe send failure detail shared by composers; unknown errors retain the draft fallback. */
export function messageSendError(error: unknown): string {
  const fallback = "Message not sent. Your text is still here.";
  const message = messageOf(error);
  if (
    /\b(failed to fetch|network ?error|network request failed|load failed|offline|not connected|connection error|timed? ?out|econnrefused|econnreset)\b/i.test(
      message,
    )
  ) {
    return "Couldn’t reach the workspace. Check your connection and try again.";
  }
  if (/mentioning everyone too often/i.test(message)) {
    return "You’re mentioning everyone too often. Try again in a minute.";
  }
  if (/permission denied|not allowed to send|do not have permission|forbidden/i.test(message)) {
    return "You don’t have permission to send messages here.";
  }
  return userFacingError(error, fallback);
}
