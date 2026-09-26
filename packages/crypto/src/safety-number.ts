/**
 * Device verification: safety numbers and QR payloads.
 *
 * Verifying a new device is a human step: an existing, trusted device and the
 * new one must derive the *same* short fingerprint from their two public
 * identity keys. If an attacker sits in the middle, the two fingerprints
 * differ and the person comparing them notices.
 *
 * The computation is:
 *
 * 1. Order the two identity public keys canonically (lexicographic), so both
 *    sides hash the same byte string regardless of who initiated.
 * 2. SHA-512 over a domain-separated concatenation.
 * 3. Render the first 60 digest bytes as 12 groups of five decimal digits,
 *    matching the Signal-style 60-digit safety number.
 *
 * Everything here is pure JS (`@noble/hashes`), so it runs identically on web,
 * Tauri and Hermes. Only the QR *scanning* camera step is platform-specific.
 */

import { sha512 } from "@noble/hashes/sha2.js";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  concatBytes,
  timingSafeEqual,
  utf8Decode,
  utf8Encode,
} from "./binary.js";

const SAFETY_CONTEXT = "aulora-safety-number-v1";
const DIGIT_GROUPS = 12;
const GROUP_SIZE = 5;
const CHUNK_BYTES = 5;

/** One device identity as used for verification. Keys are public only. */
export interface VerificationDevice {
  /** Stable device id (hex), shown alongside the fingerprint. */
  readonly deviceId: string;
  /** Ed25519 public identity key bound to the device's MLS credential. */
  readonly signaturePublicKey: Uint8Array;
}

/** A computed safety number: 60 digits split into 12 five-digit groups. */
export interface SafetyNumber {
  /** All 60 digits with no separators. */
  readonly digits: string;
  /** Twelve five-digit groups, in display order. */
  readonly groups: readonly string[];
  /** Groups joined by a single space, ready to show or read aloud. */
  readonly display: string;
}

/** Compare two byte strings lexicographically, returning the ordered pair. */
function orderKeys(a: Uint8Array, b: Uint8Array): [Uint8Array, Uint8Array] {
  const max = Math.min(a.length, b.length);
  for (let index = 0; index < max; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) {
      return left < right ? [a, b] : [b, a];
    }
  }
  return a.length <= b.length ? [a, b] : [b, a];
}

/**
 * Derives the shared 60-digit safety number for a pair of devices. The same
 * two devices always produce the same number; a substituted key does not.
 */
export function computeSafetyNumber(a: VerificationDevice, b: VerificationDevice): SafetyNumber {
  const [first, second] = orderKeys(a.signaturePublicKey, b.signaturePublicKey);
  const digest = sha512(
    concatBytes([utf8Encode(SAFETY_CONTEXT), new Uint8Array([0]), first, second]),
  );
  const groups: string[] = [];
  for (let index = 0; index < DIGIT_GROUPS; index += 1) {
    const chunk = digest.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
    let value = 0;
    for (const byte of chunk) {
      value = value * 256 + byte;
    }
    groups.push(String(value % 100_000).padStart(GROUP_SIZE, "0"));
  }
  const digits = groups.join("");
  return { digits, groups, display: groups.join(" ") };
}

/** Normalizes a safety number the user typed or read: digits only. */
export function normalizeSafetyNumber(text: string): string {
  return text.replace(/[^0-9]/g, "");
}

/**
 * Constant-time check that `candidate` matches the fingerprint for the pair.
 * Use this on the *signing* device once a person has compared the numbers; it
 * never branches on the value beyond the final boolean.
 */
export function matchesSafetyNumber(
  a: VerificationDevice,
  b: VerificationDevice,
  candidate: string,
): boolean {
  const expected = computeSafetyNumber(a, b).digits;
  const normalized = normalizeSafetyNumber(candidate);
  return timingSafeEqual(utf8Encode(expected), utf8Encode(normalized));
}

const VERIFY_PREFIX = "aulora://verify";
const QR_VERSION = 1;

/** The payload a device shows as a QR code for the other device to scan. */
export interface VerificationQrPayload {
  readonly deviceId: string;
  readonly signaturePublicKey: Uint8Array;
}

/**
 * Encodes a device into a scannable `aulora://verify?d=…` URI. The `d` value is
 * URL-safe base64 of a small JSON object so a scanner can read it back without
 * any server round trip.
 */
export function encodeVerificationQr(device: VerificationDevice): string {
  const payload = {
    v: QR_VERSION,
    id: device.deviceId,
    k: bytesToBase64Url(device.signaturePublicKey),
  };
  const encoded = bytesToBase64Url(utf8Encode(JSON.stringify(payload)));
  return `${VERIFY_PREFIX}?d=${encoded}`;
}

/**
 * Decodes a verification QR URI (native `aulora://` or an equivalent
 * `https://…/verify?d=…` universal link). Returns `null` for anything that is
 * not a well-formed device payload.
 */
export function decodeVerificationQr(uri: string): VerificationQrPayload | null {
  let encoded: string | null = null;
  const match = /[?&]d=([^&]+)/.exec(uri);
  if (match?.[1] !== undefined) {
    encoded = decodeURIComponent(match[1]);
  } else {
    try {
      encoded = new URL(uri).searchParams.get("d");
    } catch {
      encoded = null;
    }
  }
  if (encoded === null || encoded.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(utf8Decode(base64UrlToBytes(encoded))) as {
      v?: unknown;
      id?: unknown;
      k?: unknown;
    };
    if (parsed.v !== QR_VERSION || typeof parsed.id !== "string" || typeof parsed.k !== "string") {
      return null;
    }
    return { deviceId: parsed.id, signaturePublicKey: base64UrlToBytes(parsed.k) };
  } catch {
    return null;
  }
}
