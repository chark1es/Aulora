import { formatBytes } from "@aulora/core";

export { formatBytes } from "@aulora/core";

import type { TextTone } from "@aulora/ui-web";

/** Formats a storage quota; `0` means unlimited. */
export function formatQuota(bytes: number): string {
  return bytes <= 0 ? "Unlimited" : formatBytes(bytes);
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
