/**
 * Deterministic key material for the test process. Server-side sealing derives
 * its local master key from `INSTANCE_SECRET`, and download tokens sign with
 * the same secret, so it must exist before any mutation seals content.
 */
process.env.INSTANCE_SECRET ??= "aulora-test-instance-secret";
