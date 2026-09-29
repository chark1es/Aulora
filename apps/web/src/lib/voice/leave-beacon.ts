import { getFunctionName } from "convex/server";
import { convexToJson } from "convex/values";
import { api } from "../../../../../packages/convex/convex/_generated/api";

/**
 * Best-effort "I left the call" sent while the page is unloading.
 *
 * A WebSocket mutation cannot be flushed once the document is going away, so we
 * post the same `calls.leave` mutation over Convex's HTTP endpoint with
 * `keepalive`, which the browser is allowed to finish after the page is gone.
 * Without this a closed tab lingers as a participant until the server's
 * heartbeat sweep reclaims it, so the last one out never ends the call. The
 * sweep remains the backstop for clients that cannot send this at all.
 *
 * Never throws: leaving on unload is best-effort.
 */
export function sendLeaveBeacon(args: {
  readonly convexUrl: string;
  readonly token: string | null;
  readonly callId: string;
}): void {
  if (args.token === null) {
    return;
  }
  const body = JSON.stringify({
    path: getFunctionName(api.calls.leave),
    format: "convex_encoded_json",
    args: [convexToJson({ callId: args.callId })],
  });
  try {
    void fetch(`${args.convexUrl}/api/mutation`, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.token}`,
      },
      body,
    }).catch(() => undefined);
  } catch {
    // `fetch` can throw synchronously in restricted environments.
  }
}
