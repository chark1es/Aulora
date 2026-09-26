import { describe, expect, it } from "vitest";
import {
  buildLicenseKey,
  licenseChecksum,
  licenseStatus,
  maskLicenseKey,
  parseLicenseClaims,
} from "../convex/lib/license";

const ISSUED = Date.UTC(2026, 0, 1);
const EXPIRY = Date.UTC(2027, 11, 31, 23, 59, 59, 999);

describe("license key format", () => {
  it("round-trips a commercial key", () => {
    const key = buildLicenseKey({
      tier: "commercial",
      licensee: "Acme Corp",
      issuedAt: ISSUED,
      expiresAt: EXPIRY,
    });
    expect(key.startsWith("AULORA1.CO.20271231.20260101.ACME_CORP.")).toBe(true);
    const claims = parseLicenseClaims(key);
    expect(claims).toEqual({
      tier: "commercial",
      licensee: "ACME_CORP",
      issuedAt: ISSUED,
      expiresAt: EXPIRY,
    });
  });

  it("round-trips a perpetual noncommercial key", () => {
    const key = buildLicenseKey({
      tier: "noncommercial",
      licensee: "hobbyist_1",
      issuedAt: null,
      expiresAt: null,
    });
    expect(key).toBe(`AULORA1.NC.0.0.HOBBYIST_1.${licenseChecksum("AULORA1.NC.0.0.HOBBYIST_1")}`);
    expect(parseLicenseClaims(key)?.expiresAt).toBeNull();
  });

  it("rejects malformed and mis-checksummed keys", () => {
    expect(parseLicenseClaims(null)).toBeNull();
    expect(parseLicenseClaims("")).toBeNull();
    expect(parseLicenseClaims("AULORA1.CO.0.0.ACME")).toBeNull();
    expect(parseLicenseClaims("AULORA2.CO.0.0.ACME.AAAA")).toBeNull();
    expect(parseLicenseClaims("AULORA1.XX.0.0.ACME.AAAA")).toBeNull();
    expect(parseLicenseClaims("AULORA1.CO.20261301.0.ACME.AAAA")).toBeNull();

    const valid = buildLicenseKey({
      tier: "commercial",
      licensee: "acme",
      issuedAt: null,
      expiresAt: null,
    });
    const tampered = `${valid.slice(0, -1)}${valid.endsWith("0") ? "1" : "0"}`;
    expect(parseLicenseClaims(tampered)).toBeNull();
  });
});

describe("license status", () => {
  it("reports unlicensed, active, expired and invalid states", () => {
    const now = Date.UTC(2026, 5, 1);
    expect(licenseStatus(null, now).state).toBe("unlicensed");

    const active = buildLicenseKey({
      tier: "commercial",
      licensee: "Acme",
      issuedAt: ISSUED,
      expiresAt: EXPIRY,
    });
    expect(licenseStatus(active, now)).toMatchObject({ state: "active", tier: "commercial" });

    const expired = buildLicenseKey({
      tier: "commercial",
      licensee: "Acme",
      issuedAt: ISSUED,
      expiresAt: Date.UTC(2025, 0, 1),
    });
    expect(licenseStatus(expired, now).state).toBe("expired");

    expect(licenseStatus("garbage", now).state).toBe("invalid");
  });
});

describe("maskLicenseKey", () => {
  it("keeps a short prefix and suffix only", () => {
    expect(maskLicenseKey(null)).toBeNull();
    expect(maskLicenseKey("")).toBeNull();
    expect(maskLicenseKey("short")).toBe("…");
    const key = "AULORA1.CO.20271231.20260101.ACME_CORP.ABCD";
    const masked = maskLicenseKey(key);
    expect(masked).toBe("AULORA1.…ABCD");
    expect(masked).not.toBe(key);
  });
});
