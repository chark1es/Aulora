/**
 * Values shared by the server and clients for the native/desktop OAuth handoff.
 *
 * The server creates a start transaction with {@link NATIVE_AUTH_TX_TTL_MS} and
 * every client drops its matching pending record at the same moment. Keeping one
 * value here means a client never waits longer than the server will accept (and
 * so never reports a generic failure where `auth_expired` is the real answer).
 */

/** How long a started native/desktop OAuth transaction stays valid. */
export const NATIVE_AUTH_TX_TTL_MS = 10 * 60 * 1000;

/**
 * Error code for a finish whose start transaction outlived the TTL. Clients map
 * it to a plain "took too long" explanation instead of a generic failure.
 */
export const NATIVE_AUTH_EXPIRED_ERROR = "auth_expired";
