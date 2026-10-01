import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { randomToken, sha256Hex } from "./lib/crypto";
import { LICENSE_PUBLIC_KEY, LICENSE_SERVER_URL } from "./lib/licenseAuthority";
import { verifyLicenseProof } from "./lib/licenseProof";
export const refresh = internalAction({
  args: {},
  handler: async (ctx) => {
    const input = await ctx.runQuery(internal.license.validationInput, {});
    if (!input) return { verified: false };
    const base = (process.env.AULORA_LICENSE_SERVER_URL || LICENSE_SERVER_URL).replace(/\/$/, "");
    if (new URL(base).protocol !== "https:") throw new Error("License validation requires HTTPS");
    const nonce = randomToken(24);
    const keyHash = await sha256Hex(input.key);
    try {
      const response = await fetch(`${base}/api/v1/licenses/validate`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${input.key}` },
        body: JSON.stringify({ instanceId: input.instanceId, nonce, members: input.members }),
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("Licensing server unavailable");
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || !("token" in data) || typeof data.token !== "string")
        throw new Error("Invalid validation response");
      const record = await verifyLicenseProof(data.token, {
        publicKey: (process.env.AULORA_LICENSE_PUBLIC_KEY || LICENSE_PUBLIC_KEY).replace(
          /\\n/g,
          "\n",
        ),
        issuer: base,
        keyHash,
        instanceId: input.instanceId,
        nonce,
      });
      await ctx.runMutation(internal.license.saveValidation, {
        instanceId: input.instanceId,
        record,
      });
      return { verified: record.state === "active" };
    } catch {
      return {
        verified: false,
        error: "Could not verify the license. Check server connectivity and try again.",
      };
    }
  },
});
export const validate = action({
  args: {},
  handler: async (ctx): Promise<{ verified: boolean; error?: string }> => {
    await ctx.runQuery(internal.license.assertAdmin, {});
    return ctx.runAction(internal.licenseActions.refresh, {});
  },
});
