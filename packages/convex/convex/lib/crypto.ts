/**
 * Constant-time string comparison for secrets such as the one-time
 * `SETUP_TOKEN`. The length is folded into the accumulated difference so a
 * mismatched length is not a short-circuit.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/**
 * Verifies a supplied setup token against the configured one. Returns false
 * when the feature is disabled (no token configured).
 */
export function verifySetupToken(provided: string, expected: string | undefined): boolean {
  if (expected === undefined || expected.length === 0) {
    return false;
  }
  return constantTimeEqual(provided, expected);
}

/** Length in bytes of generated invite codes (hex-encoded, so 2x chars). */
export const INVITE_CODE_BYTES = 24;

/** Cryptographically random lowercase hex token. */
export function randomToken(bytes: number = INVITE_CODE_BYTES): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 hex digest, used to store invite codes without their plaintext. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
