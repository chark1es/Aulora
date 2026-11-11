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
