/**
 * Aulora license keys.
 *
 * There is no DRM. A key is a human-readable, checksummed string naming the
 * tier, the licensee and the term. The admin panel reports the parsed status and
 * reminds unlicensed commercial installs; enforcement is by the license terms
 * (see `LICENSE` and `COMMERCIAL.md`), never by the software.
 *
 * Format (uppercase, `.`-separated):
 *
 *   AULORA1.<TIER>.<EXPIRY>.<ISSUED>.<LICENSEE>.<CHECK>
 *
 * - `TIER`:   `CO` (commercial) or `NC` (noncommercial)
 * - `EXPIRY`: `YYYYMMDD`, or `0` for perpetual
 * - `ISSUED`: `YYYYMMDD`, or `0` when unknown
 * - `LICENSEE`: slug matching `[A-Z0-9_-]{2,64}`
 * - `CHECK`:  four base36 characters, an FNV-1a checksum of the first five
 *   fields. It only catches typos; it is not a signature.
 *
 * Keys are generated in-house for now; `buildLicenseKey` exists so a future
 * issuer and the tests share one format.
 */

export type LicenseTier = "commercial" | "noncommercial";

export interface LicenseClaims {
  readonly tier: LicenseTier;
  readonly licensee: string;
  /** Issue time in epoch ms, or `null` when unknown/perpetual. */
  readonly issuedAt: number | null;
  /** Expiry time in epoch ms, or `null` when perpetual. */
  readonly expiresAt: number | null;
}

export type LicenseState = "unlicensed" | "active" | "expired" | "invalid";

export interface LicenseStatus {
  readonly state: LicenseState;
  readonly tier: LicenseTier | null;
  readonly licensee: string | null;
  readonly issuedAt: number | null;
  readonly expiresAt: number | null;
  /** Short, human-readable line for the admin panel. */
  readonly note: string;
}

const PREFIX = "AULORA1";
const BASE36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const TIER_CODES: Record<LicenseTier, string> = {
  commercial: "CO",
  noncommercial: "NC",
};
const CODE_TIERS: Record<string, LicenseTier> = { CO: "commercial", NC: "noncommercial" };
const LICENSEE_PATTERN = /^[A-Z0-9_-]{2,64}$/;

/** FNV-1a over UTF-16 code units, rendered as four base36 characters. */
export function licenseChecksum(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let output = "";
  for (let index = 0; index < 4; index += 1) {
    output = BASE36[hash % 36] + output;
    hash = Math.floor(hash / 36);
  }
  return output;
}

function formatDate(ms: number | null): string {
  if (ms === null) {
    return "0";
  }
  const date = new Date(ms);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

/**
 * Parses `YYYYMMDD` to a UTC instant, or `null`. `endOfDay` picks the last
 * millisecond of the day, which keeps the whole expiry day valid; issue dates
 * resolve to midnight.
 */
function parseDate(segment: string, endOfDay: boolean): number | null {
  if (segment === "0") {
    return null;
  }
  if (!/^\d{8}$/.test(segment)) {
    return null;
  }
  const year = Number(segment.slice(0, 4));
  const month = Number(segment.slice(4, 6));
  const day = Number(segment.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const ms = endOfDay
    ? Date.UTC(year, month - 1, day, 23, 59, 59, 999)
    : Date.UTC(year, month - 1, day);
  const probe = new Date(ms);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

/** Builds a canonical key from claims; slots not representable are `0`. */
export function buildLicenseKey(claims: LicenseClaims): string {
  const licensee = claims.licensee.toUpperCase().replace(/[^A-Z0-9_-]/g, "_");
  const fields = [
    PREFIX,
    TIER_CODES[claims.tier],
    formatDate(claims.expiresAt),
    formatDate(claims.issuedAt),
    licensee,
  ];
  return [...fields, licenseChecksum(fields.join("."))].join(".");
}

/**
 * Parses a key, verifying the prefix, fields and checksum. Returns `null` for
 * anything malformed so callers can report `invalid` without throwing.
 */
export function parseLicenseClaims(key: string | null | undefined): LicenseClaims | null {
  if (key === null || key === undefined) {
    return null;
  }
  const trimmed = key.trim().toUpperCase();
  if (trimmed.length === 0) {
    return null;
  }
  const parts = trimmed.split(".");
  if (parts.length !== 6) {
    return null;
  }
  const [prefix, tierCode, expiryRaw, issuedRaw, licensee, check] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (prefix !== PREFIX) {
    return null;
  }
  const tier = CODE_TIERS[tierCode];
  if (tier === undefined) {
    return null;
  }
  if (!LICENSEE_PATTERN.test(licensee)) {
    return null;
  }
  if (licenseChecksum(parts.slice(0, 5).join(".")) !== check) {
    return null;
  }
  const expiresAt = parseDate(expiryRaw, true);
  const issuedAt = parseDate(issuedRaw, false);
  if (expiryRaw !== "0" && expiresAt === null) {
    return null;
  }
  if (issuedRaw !== "0" && issuedAt === null) {
    return null;
  }
  return { tier, licensee, issuedAt, expiresAt };
}

/** Reports the license state for the admin panel and `licenseKey` screens. */
export function licenseStatus(
  key: string | null | undefined,
  now: number = Date.now(),
): LicenseStatus {
  if (key === null || key === undefined || key.trim().length === 0) {
    return {
      state: "unlicensed",
      tier: null,
      licensee: null,
      issuedAt: null,
      expiresAt: null,
      note: "No license key. Personal and noncommercial use is free; commercial use needs a license.",
    };
  }
  const claims = parseLicenseClaims(key);
  if (claims === null) {
    return {
      state: "invalid",
      tier: null,
      licensee: null,
      issuedAt: null,
      expiresAt: null,
      note: "This license key is malformed or failed its checksum. Check for typos.",
    };
  }
  if (claims.expiresAt !== null && claims.expiresAt < now) {
    return {
      state: "expired",
      tier: claims.tier,
      licensee: claims.licensee,
      issuedAt: claims.issuedAt,
      expiresAt: claims.expiresAt,
      note: `The ${claims.tier} license for ${claims.licensee} expired. Renew to stay licensed.`,
    };
  }
  const term =
    claims.expiresAt === null
      ? "perpetual"
      : `expires ${new Date(claims.expiresAt).toISOString().slice(0, 10)}`;
  return {
    state: "active",
    tier: claims.tier,
    licensee: claims.licensee,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
    note: `${claims.tier === "commercial" ? "Commercial" : "Noncommercial"} license for ${claims.licensee}, ${term}.`,
  };
}

/** Shows enough of a key to identify it without leaking the whole string. */
export function maskLicenseKey(key: string | null | undefined): string | null {
  if (key === null || key === undefined) {
    return null;
  }
  const trimmed = key.trim();
  if (trimmed.length <= 10) {
    return trimmed.length === 0 ? null : "…";
  }
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}
