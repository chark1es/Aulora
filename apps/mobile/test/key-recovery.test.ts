import { describe, expect, it } from "vitest";
import {
  buildRecoveryBundle,
  MIN_PASSPHRASE_LENGTH,
  restoreRecoveryBundle,
  validateRecoveryPassphrase,
} from "../src/lib/key-recovery";

const TEST_COST = { t: 1, m: 64, p: 1 };
const PASSPHRASE = "a-strong-recovery-phrase";
const identity = new Uint8Array(64).map((_, index) => index);
const historyKeys = [{ channelId: "channel-1", key: new Uint8Array(32).fill(3), fromEpoch: 1 }];

describe("validateRecoveryPassphrase", () => {
  it("enforces a minimum length and non-blank value", () => {
    expect(validateRecoveryPassphrase("short").ok).toBe(false);
    expect(validateRecoveryPassphrase(" ".repeat(MIN_PASSPHRASE_LENGTH)).ok).toBe(false);
    expect(validateRecoveryPassphrase(PASSPHRASE).ok).toBe(true);
  });
});

describe("recovery bundle", () => {
  it("round-trips identity and history keys", async () => {
    const bundle = await buildRecoveryBundle({
      passphrase: PASSPHRASE,
      identity,
      historyKeys,
      cost: TEST_COST,
    });
    expect(bundle.backupCiphertext.startsWith("aulora-backup-v1.")).toBe(true);
    expect(bundle.backupCiphertext).not.toContain("channel-1");

    const restored = await restoreRecoveryBundle({
      passphrase: PASSPHRASE,
      backupCiphertext: bundle.backupCiphertext,
      kdfParams: bundle.kdfParams,
    });
    expect(restored.identity).toEqual(identity);
    expect(restored.historyKeys).toEqual(historyKeys);
  });

  it("refuses a weak passphrase and a wrong restore passphrase", async () => {
    await expect(
      buildRecoveryBundle({ passphrase: "weak", identity, cost: TEST_COST }),
    ).rejects.toThrow();

    const bundle = await buildRecoveryBundle({
      passphrase: PASSPHRASE,
      identity,
      cost: TEST_COST,
    });
    await expect(
      restoreRecoveryBundle({
        passphrase: "the-wrong-passphrase",
        backupCiphertext: bundle.backupCiphertext,
        kdfParams: bundle.kdfParams,
      }),
    ).rejects.toThrow();
  });
});
