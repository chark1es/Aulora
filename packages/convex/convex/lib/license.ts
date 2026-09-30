export type LicenseTier = "commercial" | "noncommercial";
export type LicenseState = "unlicensed" | "active" | "expired" | "invalid";
export interface LicenseStatus {
  state: LicenseState;
  tier: LicenseTier | null;
  licensee: string | null;
  issuedAt: number | null;
  expiresAt: number | null;
  note: string;
}
export interface ValidationRecord {
  keyHash: string;
  licenseId?: string;
  billingModel?: "monthly-active-users";
  state: LicenseState;
  tier: LicenseTier | null;
  licensee: string | null;
  issuedAt: number | null;
  expiresAt: number | null;
  checkedAt: number;
  validUntil: number;
  note: string;
  tags: string[];
  seats: number;
}
export const isLicenseKey = (key: string) => /^AULORA2_[A-Za-z0-9_-]{43}$/.test(key);
export function licenseStatus(
  key: string | null | undefined,
  now = Date.now(),
  validation?: ValidationRecord,
): LicenseStatus {
  const empty = { tier: null, licensee: null, issuedAt: null, expiresAt: null };
  if (!key?.trim())
    return {
      ...empty,
      state: "unlicensed",
      note: "Personal and noncommercial use is free. Company subscriptions are $1 per monthly active user.",
    };
  if (!isLicenseKey(key))
    return {
      ...empty,
      state: "invalid",
      note: "This key uses an unsupported format. Request an AULORA2 subscription key.",
    };
  if (!validation)
    return {
      ...empty,
      state: "invalid",
      note: "The key is saved and awaiting validation by the Aulora licensing server.",
    };
  const { state, tier, licensee, issuedAt, expiresAt, note } = validation;
  if (expiresAt !== null && expiresAt <= now)
    return {
      state: "expired",
      tier,
      licensee,
      issuedAt,
      expiresAt,
      note: "The paid license term has expired. Renew the subscription to stay licensed.",
    };
  if (validation.validUntil <= now)
    return {
      ...empty,
      state: "invalid",
      note: "Server validation has expired. Check connectivity to the Aulora licensing server and verify again.",
    };
  return { state, tier, licensee, issuedAt, expiresAt, note };
}
export function maskLicenseKey(key: string | null | undefined): string | null {
  if (!key?.trim()) return null;
  const trimmed = key.trim();
  return trimmed.length <= 10 ? "…" : `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}
