const INT64_BYTES = 8;
const INT64_SIGN_BIT = 1n << 63n;
const INT64_MODULUS = 1n << 64n;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeInteger(encoded: string): bigint {
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== INT64_BYTES) {
    return 0n;
  }
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    const byte = bytes.at(index);
    value = (value << 8n) | BigInt(byte ?? 0);
  }
  return value >= INT64_SIGN_BIT ? value - INT64_MODULUS : value;
}

/**
 * Convex's HTTP JSON format encodes int64/bigint values as
 * `{"$integer":"<base64 little-endian>"}`. Decode them recursively so callers
 * get a real `bigint` (permission bitfields, channel overrides) instead of an
 * opaque object.
 */
export function decodeConvexValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => decodeConvexValue(entry));
  }
  if (!isRecord(value)) {
    return value;
  }
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "$integer" && typeof value.$integer === "string") {
    return decodeInteger(value.$integer);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, decodeConvexValue(entry)]),
  );
}
