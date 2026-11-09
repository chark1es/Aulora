import { getFunctionName } from "convex/server";
import { convexToJson } from "convex/values";
import { api } from "../../../../../packages/convex/convex/_generated/api";

/**
 * Best-effort "I left" for a guest whose tab is going away. Like the member
 * version it posts the mutation over Convex's HTTP endpoint with `keepalive`,
 * which the browser may finish after the page is gone. A guest has no identity,
 * so there is no Authorization header: the session token argument is the only
 * credential. Never throws; the heartbeat sweep is the backstop.
 */
export function sendGuestLeaveBeacon(args: {
  readonly convexUrl: string;
  readonly sessionToken: string;
}): void {
  const body = JSON.stringify({
    path: getFunctionName(api.guestCalls.leave),
    format: "convex_encoded_json",
    args: [convexToJson({ sessionToken: args.sessionToken })],
  });
  try {
    void fetch(`${args.convexUrl}/api/mutation`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body,
      referrerPolicy: "no-referrer",
    }).catch(() => undefined);
  } catch {
    // `fetch` can throw synchronously in restricted environments.
  }
}
