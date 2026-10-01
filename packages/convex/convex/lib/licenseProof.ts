import { importSPKI, jwtVerify } from "jose";
import type { ValidationRecord } from "./license";
export async function verifyLicenseProof(
  token: string,
  input: { publicKey: string; issuer: string; keyHash: string; instanceId: string; nonce: string },
  now = Date.now(),
): Promise<ValidationRecord> {
  const { payload } = await jwtVerify(token, await importSPKI(input.publicKey, "RS256"), {
    algorithms: ["RS256"],
    issuer: input.issuer,
    audience: "aulora-license-validation",
    subject: input.keyHash,
    currentDate: new Date(now),
  });
  if (
    payload.instanceId !== input.instanceId ||
    payload.nonce !== input.nonce ||
    (payload.billingModel !== undefined && payload.billingModel !== "monthly-active-users") ||
    (payload.billingModel === "monthly-active-users" &&
      (typeof payload.licenseId !== "string" || payload.licenseId.length < 1)) ||
    typeof payload.valid !== "boolean" ||
    typeof payload.reason !== "string" ||
    typeof payload.exp !== "number" ||
    payload.exp * 1000 > now + 3605000 ||
    typeof payload.iat !== "number" ||
    payload.iat * 1000 > now + 5000
  )
    throw new Error("Invalid validation claims");
  if (
    payload.valid &&
    (payload.reason !== "active" ||
      payload.tier !== "commercial" ||
      typeof payload.licensee !== "string" ||
      typeof payload.seats !== "number" ||
      !Number.isInteger(payload.seats) ||
      payload.seats < (payload.billingModel === "monthly-active-users" ? 0 : 1) ||
      typeof payload.issuedAt !== "number" ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt <= now ||
      !Array.isArray(payload.tags) ||
      payload.tags.some((t) => typeof t !== "string"))
  )
    throw new Error("Invalid commercial license claims");
  return {
    keyHash: input.keyHash,
    ...(payload.billingModel === "monthly-active-users"
      ? { billingModel: payload.billingModel, licenseId: payload.licenseId as string }
      : {}),
    state: payload.valid ? "active" : payload.reason === "expired" ? "expired" : "invalid",
    tier: payload.valid ? "commercial" : null,
    licensee: payload.valid ? (payload.licensee as string) : null,
    issuedAt: payload.valid ? (payload.issuedAt as number) : null,
    expiresAt: payload.valid ? (payload.expiresAt as number) : null,
    checkedAt: now,
    validUntil: Math.min(
      payload.exp * 1000,
      typeof payload.expiresAt === "number" ? payload.expiresAt : Infinity,
    ),
    note: payload.valid
      ? `Commercial subscription for ${payload.licensee}. Validated by the Aulora licensing server.`
      : `License validation failed: ${payload.reason}. Contact the license administrator.`,
    tags: payload.valid ? (payload.tags as string[]) : [],
    seats: payload.valid ? (payload.seats as number) : 0,
  };
}
