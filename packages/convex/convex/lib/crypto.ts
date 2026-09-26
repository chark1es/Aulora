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
