import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { LICENSE_SERVER_URL } from "./lib/licenseAuthority";
import { openString } from "./lib/sse";

export const report = internalAction({
  args: {},
  handler: async (ctx) => {
    const groups = await ctx.runQuery(internal.licenseUsage.reports, {});
    const base = (process.env.AULORA_LICENSE_SERVER_URL || LICENSE_SERVER_URL).replace(/\/$/, "");
    if (new URL(base).protocol !== "https:") throw new Error("Usage reports require HTTPS");
    for (const input of groups) {
      const key = await openString(
        { scope: "license-report-key", recordId: input.licenseId },
        input.ciphertext,
      );
      for (const row of input.reports) {
        try {
          const response = await fetch(base + "/api/v1/licenses/usage", {
            method: "POST",
            redirect: "error",
            headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
            body: JSON.stringify({
              instanceId: input.instanceId,
              licenseId: row.licenseId,
              month: row.month,
              activeUsers: row.activeUsers,
              final: row.final,
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) continue;
          const result: unknown = await response.json();
          if (
            !result ||
            typeof result !== "object" ||
            !("accepted" in result) ||
            result.accepted !== true
          )
            continue;
          await ctx.runMutation(internal.licenseUsage.acknowledge, {
            id: row.id,
            activeUsers: row.activeUsers,
            final: row.final,
          });
        } catch {
          /* Keep the aggregate queued. Retried without losing or clearing activity. */
        }
      }
    }
  },
});
