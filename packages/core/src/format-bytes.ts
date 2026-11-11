const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;
const BYTE_FACTOR = 1024;

/** Formats a byte count with binary units, e.g. `1.5 MiB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }
  const [firstUnit, ...largerUnits] = BYTE_UNITS;
  let value = bytes;
  let unit: (typeof BYTE_UNITS)[number] = firstUnit;
  for (const larger of largerUnits) {
    if (value < BYTE_FACTOR) {
      break;
    }
    value /= BYTE_FACTOR;
    unit = larger;
  }
  const rounded =
    unit === firstUnit ? String(Math.round(value)) : value.toFixed(value >= 10 ? 0 : 1);
  return `${rounded} ${unit}`;
}
