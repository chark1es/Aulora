import { describe, expect, it } from "vitest";
import {
  base64UrlToBytes,
  createKeyBackup,
  decodeKeyBackupPayload,
  deriveBackupKey,
  encodeKeyBackupPayload,
  MlsEngineError,
  openKeyBackup,
  parseArgon2idParams,
  validateArgon2idParams,
} from "../src/index.js";

/** Deliberately weak cost: Argon2id is slow, and these tests only need logic. */
const TEST_COST = { t: 1, m: 64, p: 1 };

const identity = new Uint8Array(64).map((_, index) => index);
const historyKeys = [
  { channelId: "channel-1", key: new Uint8Array(32).fill(7), fromEpoch: 3 },
  { channelId: "channel-2", key: new Uint8Array(32).fill(9) },
];

describe("key backup payload encoding", () => {
  it("round-trips identity and history keys", () => {
    const encoded = encodeKeyBackupPayload({ identity, historyKeys });
    const decoded = decodeKeyBackupPayload(encoded);
    expect(decoded.identity).toEqual(identity);
    expect(decoded.historyKeys).toHaveLength(2);
    expect(decoded.historyKeys[0]).toEqual(historyKeys[0]);
    expect(decoded.historyKeys[1]).toEqual(historyKeys[1]);
  });
});

describe("createKeyBackup / openKeyBackup", () => {
  it("restores the payload with the right passphrase", async () => {
    const backup = await createKeyBackup({
      passphrase: "correct horse battery staple",
      payload: { identity, historyKeys },
      cost: TEST_COST,
    });
    expect(backup.backupCiphertext.startsWith("aulora-backup-v1.")).toBe(true);
    expect(backup.backupCiphertext).not.toContain("channel-1");

    const restored = await openKeyBackup({
      passphrase: "correct horse battery staple",
      backupCiphertext: backup.backupCiphertext,
      kdfParams: backup.kdfParams,
    });
    expect(restored.identity).toEqual(identity);
    expect(restored.historyKeys).toEqual(historyKeys);
  });

  it("fails on a wrong passphrase without leaking the reason", async () => {
    const backup = await createKeyBackup({
      passphrase: "right",
      payload: { identity, historyKeys: [] },
      cost: TEST_COST,
    });
    await expect(
      openKeyBackup({
        passphrase: "wrong",
        backupCiphertext: backup.backupCiphertext,
        kdfParams: backup.kdfParams,
      }),
    ).rejects.toBeInstanceOf(MlsEngineError);
  });

  it("rejects a tampered ciphertext", async () => {
    const backup = await createKeyBackup({
      passphrase: "right",
      payload: { identity, historyKeys: [] },
      cost: TEST_COST,
    });
    const prefix = "aulora-backup-v1.";
    const bytes = base64UrlToBytes(backup.backupCiphertext.slice(prefix.length));
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
    let body = "";
    for (const byte of bytes) {
      body += String.fromCharCode(byte);
    }
    const tampered = prefix + btoa(body).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await expect(
      openKeyBackup({
        passphrase: "right",
        backupCiphertext: tampered,
        kdfParams: backup.kdfParams,
      }),
    ).rejects.toBeInstanceOf(MlsEngineError);
  });

  it("generates a fresh salt per backup", async () => {
    const first = await createKeyBackup({
      passphrase: "p",
      payload: { identity, historyKeys: [] },
      cost: TEST_COST,
    });
    const second = await createKeyBackup({
      passphrase: "p",
      payload: { identity, historyKeys: [] },
      cost: TEST_COST,
    });
    expect(parseArgon2idParams(first.kdfParams).salt).not.toBe(
      parseArgon2idParams(second.kdfParams).salt,
    );
    expect(first.backupCiphertext).not.toBe(second.backupCiphertext);
  });
});

describe("Argon2id parameter validation", () => {
  it("derives a 32-byte key for valid parameters", async () => {
    const backup = await createKeyBackup({
      passphrase: "p",
      payload: { identity, historyKeys: [] },
      cost: TEST_COST,
    });
    const params = parseArgon2idParams(backup.kdfParams);
    const key = await deriveBackupKey("p", params);
    expect(key).toHaveLength(32);
  });

  it("rejects out-of-range cost parameters", () => {
    expect(() =>
      validateArgon2idParams({
        algorithm: "argon2id",
        salt: "AAAAAAAAAAAAAAAA",
        t: 999,
        m: 64,
        p: 1,
        dkLen: 32,
        version: 0x13,
      }),
    ).toThrow(MlsEngineError);
    expect(() =>
      validateArgon2idParams({
        algorithm: "argon2id",
        salt: "AAAA",
        t: 1,
        m: 64,
        p: 1,
        dkLen: 32,
        version: 0x13,
      }),
    ).toThrow(MlsEngineError);
    expect(() => parseArgon2idParams("not json")).toThrow(MlsEngineError);
  });
});
