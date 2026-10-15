import type { TextTone } from "@aulora/ui-web";

/**
 * Pure view helpers for the Phase 6 instance admin and license screens. Nothing
 * here talks to the server: it formats the values Convex already returned, so
 * the components stay presentational and the server remains the source of truth.
 */

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;
const BYTE_FACTOR = 1024;

/** Formats a byte count with binary units, e.g. `1.5 MiB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }
  let value = bytes;
  let unit = 0;
  while (value >= BYTE_FACTOR && unit < BYTE_UNITS.length - 1) {
    value /= BYTE_FACTOR;
    unit += 1;
  }
  const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(value >= 10 ? 0 : 1);
  return `${rounded} ${BYTE_UNITS[unit]}`;
}

/** Formats a storage quota; `0` means unlimited. */
export function formatQuota(bytes: number): string {
  return bytes <= 0 ? "Unlimited" : formatBytes(bytes);
}

const UNIT_BYTES: Record<string, number> = {
  b: 1,
  kb: 1000,
  kib: 1024,
  mb: 1000 * 1000,
  mib: 1024 * 1024,
  gb: 1000 * 1000 * 1000,
  gib: 1024 * 1024 * 1024,
  tb: 1000 * 1000 * 1000 * 1000,
  tib: 1024 * 1024 * 1024 * 1024,
};

/**
 * Parses a human byte size (`"25 MiB"`, `"2GiB"`, `"500"`) into an integer byte
 * count, or `null` when it is not a positive size. A bare number is bytes.
 */
export function parseByteInput(value: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(value);
  if (match === null) {
    return null;
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? "").toLowerCase();
  const factor = unit === "" ? 1 : UNIT_BYTES[unit];
  if (factor === undefined || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return Math.round(amount * factor);
}

/** Binary units the storage editor lets an operator pick from. */
export type ByteUnit = "KiB" | "MiB" | "GiB" | "TiB";

/** Binary (1024-based) byte factor for each selectable unit. */
export const BYTE_UNIT_BYTES: Record<ByteUnit, number> = {
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
};

/** Dropdown options for {@link ByteUnit}, smallest first. */
export const BYTE_UNIT_OPTIONS: readonly { readonly value: ByteUnit; readonly label: string }[] = [
  { value: "KiB", label: "KiB" },
  { value: "MiB", label: "MiB" },
  { value: "GiB", label: "GiB" },
  { value: "TiB", label: "TiB" },
];

// Largest first, so the first exact match is the largest readable unit.
const BYTE_UNIT_DESCENDING: readonly ByteUnit[] = ["TiB", "GiB", "MiB", "KiB"];

/**
 * Splits a byte count into a number and a binary unit for the storage editor.
 * Picks the largest unit that divides the value exactly; when there is no exact
 * match it falls back to the largest unit with a whole-number magnitude.
 * `0` (unlimited) renders as `0 GiB`.
 */
export function splitByteSize(bytes: number): { value: string; unit: ByteUnit } {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { value: "0", unit: "GiB" };
  }
  for (const unit of BYTE_UNIT_DESCENDING) {
    const factor = BYTE_UNIT_BYTES[unit];
    if (bytes % factor === 0) {
      return { value: String(bytes / factor), unit };
    }
  }
  for (const unit of BYTE_UNIT_DESCENDING) {
    const factor = BYTE_UNIT_BYTES[unit];
    if (bytes >= factor) {
      return { value: String(bytes / factor), unit };
    }
  }
  return { value: String(bytes / BYTE_UNIT_BYTES.KiB), unit: "KiB" };
}

/**
 * Composes a number string and a binary unit back into integer bytes, or `null`
 * when the value is not a finite, non-negative number. `"0"` is valid (unlimited)
 * and empty input is rejected so callers can treat it explicitly.
 */
export function composeByteSize(value: string, unit: ByteUnit): number | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }
  return Math.round(amount * BYTE_UNIT_BYTES[unit]);
}

export type LicenseState = "unlicensed" | "active" | "expired" | "invalid";

export function licenseStateLabel(state: LicenseState): string {
  switch (state) {
    case "active":
      return "Active";
    case "expired":
      return "Expired";
    case "invalid":
      return "Invalid";
    default:
      return "Unlicensed";
  }
}

export function licenseStateTone(state: LicenseState): TextTone {
  switch (state) {
    case "active":
      return "secondary";
    case "expired":
    case "invalid":
      return "danger";
    default:
      return "accent";
  }
}

export type BackupStatus = "requested" | "running" | "succeeded" | "failed";

export function backupStatusLabel(status: BackupStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    default:
      return "Requested";
  }
}

export function backupStatusTone(status: BackupStatus): TextTone {
  switch (status) {
    case "succeeded":
      return "secondary";
    case "failed":
      return "danger";
    case "running":
      return "accent";
    default:
      return "muted";
  }
}

/** Deterministic UTC timestamp for display and tests. */
export function formatTimestamp(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
