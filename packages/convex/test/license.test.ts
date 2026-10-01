import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  isLicenseKey,
  licenseStatus,
  maskLicenseKey,
  type ValidationRecord,
} from "../convex/lib/license";
import { verifyLicenseProof } from "../convex/lib/licenseProof";

const key = `AULORA2_${"a".repeat(43)}`;
const now = Date.now();
const record: ValidationRecord = {
  keyHash: "hash",
  state: "active",
  tier: "commercial",
  licensee: "Acme",
  issuedAt: now - 1000,
  expiresAt: now + 86400000,
  checkedAt: now,
  validUntil: now + 3600000,
  note: "Verified",
  tags: [],
  seats: 10,
};
describe("subscription license status", () => {
  it("requires an opaque key and live server validation", () => {
    expect(isLicenseKey(key)).toBe(true);
    expect(isLicenseKey("AULORA1.CO.0.0.ACME.ABCD")).toBe(false);
    expect(licenseStatus(null, now).state).toBe("unlicensed");
    expect(licenseStatus(key, now).state).toBe("invalid");
    expect(licenseStatus(key, now, record).state).toBe("active");
    expect(licenseStatus(key, now, { ...record, validUntil: now - 1 }).state).toBe("invalid");
    expect(licenseStatus(key, now, { ...record, expiresAt: now - 1 }).state).toBe("expired");
  });
  it("does not expose the full key", () => {
    expect(maskLicenseKey(null)).toBeNull();
    expect(maskLicenseKey("")).toBeNull();
    expect(maskLicenseKey("short")).toBe("…");
    expect(maskLicenseKey(key)).toBe("AULORA2_…aaaa");
  });
});
describe("authority signature verification", () => {
  async function fixture(extra: Record<string, unknown> = {}) {
    const keys = await generateKeyPair("RS256", { extractable: true });
    const publicKey = await exportSPKI(keys.publicKey);
    const input = {
      publicKey,
      issuer: "https://aulora-licenses.spwnd.dev",
      keyHash: "hash",
      instanceId: "instance-1",
      nonce: "nonce-123",
    };
    const token = await new SignJWT({
      valid: true,
      reason: "active",
      tier: "commercial",
      licensee: "Acme",
      issuedAt: now - 1000,
      expiresAt: now + 86400000,
      tags: ["nonprofit"],
      seats: 10,
      instanceId: input.instanceId,
      nonce: input.nonce,
      ...extra,
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(input.issuer)
      .setSubject(input.keyHash)
      .setAudience("aulora-license-validation")
      .setIssuedAt(Math.floor(now / 1000))
      .setExpirationTime(Math.floor(now / 1000) + 3600)
      .sign(keys.privateKey);
    return { token, input };
  }
  it("accepts a signed subscription response", async () => {
    const { token, input } = await fixture();
    expect(await verifyLicenseProof(token, input, now)).toMatchObject({
      state: "active",
      licensee: "Acme",
      tags: ["nonprofit"],
      seats: 10,
    });
  });
  it("accepts zero estimated users on an activity-billed renewal and rejects unknown billing models", async () => {
    const valid = await fixture({
      seats: 0,
      billingModel: "monthly-active-users",
      licenseId: "license-1",
    });
    expect(await verifyLicenseProof(valid.token, valid.input, now)).toMatchObject({
      seats: 0,
      billingModel: "monthly-active-users",
      licenseId: "license-1",
    });
    const invalid = await fixture({ billingModel: "unknown" });
    await expect(verifyLicenseProof(invalid.token, invalid.input, now)).rejects.toThrow();
  });
  it("rejects a response for another key, installation, or request", async () => {
    const { token, input } = await fixture();
    for (const patch of [
      { keyHash: "other" },
      { instanceId: "other" },
      { nonce: "other" },
      { issuer: "https://other.test" },
    ])
      await expect(verifyLicenseProof(token, { ...input, ...patch }, now)).rejects.toThrow();
  });
  it("rejects a forged signature", async () => {
    const { token, input } = await fixture();
    const parts = token.split(".");
    const signature = parts[2];
    if (!signature) throw new Error("Missing signature");
    parts[2] = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
    await expect(verifyLicenseProof(parts.join("."), input, now)).rejects.toThrow();
  });
  it("rejects expired proofs and perpetual claims", async () => {
    const valid = await fixture();
    await expect(verifyLicenseProof(valid.token, valid.input, now + 3601000)).rejects.toThrow();
    const perpetual = await fixture({ expiresAt: null });
    await expect(verifyLicenseProof(perpetual.token, perpetual.input, now)).rejects.toThrow();
  });
  it("records a signed revocation as invalid", async () => {
    const { token, input } = await fixture({ valid: false, reason: "revoked" });
    expect(await verifyLicenseProof(token, input, now)).toMatchObject({
      state: "invalid",
      tier: null,
      seats: 0,
    });
  });
});
