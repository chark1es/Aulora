import { describe, expect, it } from "vitest";
import {
  createSharingIdentity,
  ensureSharingIdentity,
  MlsEngineError,
  memoryKeyStore,
  openHistoryKeys,
  readSharingIdentity,
  sealHistoryKeys,
  sharingPublicKeyBase64,
} from "../src/index.js";

const shares = [
  { channelId: "channel-1", key: new Uint8Array(32).fill(1), fromEpoch: 2 },
  { channelId: "channel-2", key: new Uint8Array(32).fill(2) },
];

describe("sharing identity storage", () => {
  it("creates, persists and reloads an X25519 key pair", async () => {
    const store = memoryKeyStore();
    expect(await readSharingIdentity(store)).toBeUndefined();
    const created = await ensureSharingIdentity(store);
    const reloaded = await ensureSharingIdentity(store);
    expect(reloaded.publicKey).toEqual(created.publicKey);
    expect(reloaded.privateKey).toEqual(created.privateKey);
    expect(created.publicKey).toHaveLength(32);
    expect(sharingPublicKeyBase64(created)).not.toContain("+");
  });
});

describe("sealHistoryKeys / openHistoryKeys", () => {
  it("seals history keys to a recipient who can open them", () => {
    const recipient = createSharingIdentity();
    const envelope = sealHistoryKeys({
      recipientPublicKey: recipient.publicKey,
      shares,
    });
    expect(envelope.startsWith("aulora-history-v1.")).toBe(true);
    expect(envelope).not.toContain("channel-1");

    const opened = openHistoryKeys({
      envelope,
      recipientPrivateKey: recipient.privateKey,
    });
    expect(opened).toEqual(shares);
  });

  it("fails for a different recipient", () => {
    const recipient = createSharingIdentity();
    const other = createSharingIdentity();
    const envelope = sealHistoryKeys({ recipientPublicKey: recipient.publicKey, shares });
    expect(() => openHistoryKeys({ envelope, recipientPrivateKey: other.privateKey })).toThrow(
      MlsEngineError,
    );
  });

  it("rejects tampered and malformed envelopes", () => {
    const recipient = createSharingIdentity();
    const envelope = sealHistoryKeys({ recipientPublicKey: recipient.publicKey, shares });
    const tampered = `${envelope.slice(0, -4)}AAAA`;
    expect(() =>
      openHistoryKeys({ envelope: tampered, recipientPrivateKey: recipient.privateKey }),
    ).toThrow(MlsEngineError);
    expect(() =>
      openHistoryKeys({
        envelope: "aulora-history-v1.short",
        recipientPrivateKey: recipient.privateKey,
      }),
    ).toThrow(MlsEngineError);
    expect(() =>
      openHistoryKeys({ envelope: "nonsense", recipientPrivateKey: recipient.privateKey }),
    ).toThrow(MlsEngineError);
  });

  it("rejects a recipient key of the wrong length", () => {
    expect(() => sealHistoryKeys({ recipientPublicKey: new Uint8Array(16), shares })).toThrow(
      MlsEngineError,
    );
  });
});
