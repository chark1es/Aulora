import { beforeEach, describe, expect, it } from "vitest";
import { deriveLocalMasterKey, EkmKeyUnavailableError, getEkmSettings } from "../convex/lib/ekm";
import {
  clearKeyCache,
  type EncryptionContext,
  encryptionConfigured,
  isSealed,
  openBytes,
  openString,
  primeMasterKey,
  SseError,
  sealBytes,
  sealString,
} from "../convex/lib/sse";

const ENV: Record<string, string | undefined> = { INSTANCE_SECRET: "instance-secret-for-tests" };
const CONTEXT: EncryptionContext = {
  scope: "channel.name",
  recordId: "chan-1",
  workspaceId: "ws-1",
};

function bytes(length: number, seed = 1): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    out[index] = (index * 31 + seed) % 256;
  }
  return out;
}

describe("sse string round-trip", () => {
  beforeEach(() => {
    clearKeyCache();
  });

  it("seals and opens a string", async () => {
    const sealed = await sealString(CONTEXT, "hello secrets", { env: ENV });
    expect(isSealed(sealed)).toBe(true);
    await expect(openString(CONTEXT, sealed, { env: ENV })).resolves.toBe("hello secrets");
  });

  it("names the version and format in the envelope", async () => {
    const sealed = await sealString(CONTEXT, "x", { env: ENV });
    const parts = sealed.split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("aulora-sse-v1");
    expect(parts[1]).toBe("1");
    expect(parts[2]).toBeTruthy();
    expect(parts[3]).toBeTruthy();
  });

  it("produces different ciphertext for the same plaintext", async () => {
    const first = await sealString(CONTEXT, "same", { env: ENV });
    const second = await sealString(CONTEXT, "same", { env: ENV });
    expect(first).not.toBe(second);
  });

  it("produces different ciphertext for a different scope", async () => {
    const first = await sealString(CONTEXT, "same", { env: ENV });
    const second = await sealString({ ...CONTEXT, scope: "channel.topic" }, "same", { env: ENV });
    expect(first).not.toBe(second);
  });

  it("rejects a tampered envelope", async () => {
    const sealed = await sealString(CONTEXT, "tamper me", { env: ENV });
    const parts = sealed.split(".");
    const cipherPart = parts[3] ?? "";
    const first = cipherPart.charAt(0);
    const flipped = `${first === "A" ? "B" : "A"}${cipherPart.slice(1)}`;
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${flipped}`;
    await expect(openString(CONTEXT, tampered, { env: ENV })).rejects.toMatchObject({
      name: "SseError",
      code: "decrypt-failed",
    });
  });

  it("rejects an envelope opened under the wrong scope", async () => {
    const sealed = await sealString(CONTEXT, "scoped", { env: ENV });
    await expect(
      openString({ ...CONTEXT, scope: "channel.topic" }, sealed, { env: ENV }),
    ).rejects.toBeInstanceOf(SseError);
  });

  it("reports legacy values as not sealed", async () => {
    await expect(openString(CONTEXT, "bXNn", { env: ENV })).rejects.toMatchObject({
      name: "SseError",
      code: "not-sealed",
    });
  });

  it("rejects unknown versions and malformed envelopes", async () => {
    await expect(
      openString(CONTEXT, "aulora-sse-v9.1.aXY.Y2lwaGVy", { env: ENV }),
    ).rejects.toMatchObject({ code: "unknown-version" });
    await expect(openString(CONTEXT, "aulora-sse-v1.aXY", { env: ENV })).rejects.toMatchObject({
      code: "malformed",
    });
  });

  it("only treats aulora-sse-* values as sealed", () => {
    expect(isSealed("aulora-sse-v1.a.b.c")).toBe(true);
    expect(isSealed("aulora-sse-")).toBe(true);
    expect(isSealed("not-a-sealed-value")).toBe(false);
    expect(isSealed("")).toBe(false);
  });
});

describe("sse key management", () => {
  beforeEach(() => {
    clearKeyCache();
  });

  it("reports configured state from the local fallback secret", () => {
    expect(encryptionConfigured({})).toBe(false);
    expect(encryptionConfigured(ENV)).toBe(true);
    expect(encryptionConfigured({ INSTANCE_SECRET: "x" })).toBe(true);
    expect(encryptionConfigured({ INSTANCE_SECRET: "x", AULORA_ENCRYPTION_ENABLED: "false" })).toBe(
      false,
    );
  });

  it("throws when no local key material exists", async () => {
    expect(encryptionConfigured({})).toBe(false);
    await expect(sealString(CONTEXT, "nope", { env: {} })).rejects.toBeInstanceOf(
      EkmKeyUnavailableError,
    );
  });

  it("derives the same local master key deterministically", async () => {
    const settings = getEkmSettings(ENV);
    const first = await deriveLocalMasterKey(ENV, settings);
    const second = await deriveLocalMasterKey(ENV, settings);
    expect(first).toEqual(second);
    expect(first).toHaveLength(32);
  });

  it("primes the local key without a network call", async () => {
    await primeMasterKey({ env: ENV });
    const sealed = await sealString(CONTEXT, "primed", { env: ENV });
    await expect(openString(CONTEXT, sealed, { env: ENV })).resolves.toBe("primed");
  });
});

describe("sse key rotation", () => {
  const ENV_V1: Record<string, string | undefined> = {
    INSTANCE_SECRET: "instance-secret-for-tests",
    AULORA_ENCRYPTION_KEY_VERSION: "1",
  };
  const ENV_V2: Record<string, string | undefined> = {
    ...ENV_V1,
    AULORA_ENCRYPTION_KEY_VERSION: "2",
  };

  beforeEach(() => {
    clearKeyCache();
  });

  it("opens content sealed under an older version after rotating the env", async () => {
    const sealed = await sealString(CONTEXT, "rotate me", { env: ENV_V1 });
    expect(sealed.split(".")[1]).toBe("1");
    clearKeyCache();
    await expect(openString(CONTEXT, sealed, { env: ENV_V2 })).resolves.toBe("rotate me");
  });

  it("derives a different data key per version", async () => {
    const sealedV1 = await sealString(CONTEXT, "same value", { env: ENV_V1 });
    clearKeyCache();
    const sealedV2 = await sealString(CONTEXT, "same value", { env: ENV_V2 });
    expect(sealedV1.split(".")[1]).toBe("1");
    expect(sealedV2.split(".")[1]).toBe("2");
    expect(sealedV1).not.toBe(sealedV2);
  });

  it("rejects a v1 envelope forced to be read as v2", async () => {
    const sealedV1 = await sealString(CONTEXT, "do not cross", { env: ENV_V1 });
    const parts = sealedV1.split(".");
    parts[1] = "2";
    clearKeyCache();
    await expect(openString(CONTEXT, parts.join("."), { env: ENV_V2 })).rejects.toMatchObject({
      name: "SseError",
      code: "decrypt-failed",
    });
  });

  it("still produces distinct ciphertexts for distinct scopes", async () => {
    const first = await sealString(CONTEXT, "same", { env: ENV_V1 });
    clearKeyCache();
    const second = await sealString({ ...CONTEXT, scope: "channel.topic" }, "same", {
      env: ENV_V2,
    });
    expect(first).not.toBe(second);
  });

  it("derives a different data key per version for bytes too", async () => {
    const payload = bytes(32, 9);
    const sealedV1 = await sealBytes(CONTEXT, payload, { env: ENV_V1 });
    clearKeyCache();
    const sealedV2 = await sealBytes(CONTEXT, payload, { env: ENV_V2 });
    expect(sealedV1).not.toEqual(sealedV2);
    clearKeyCache();
    await expect(openBytes(CONTEXT, sealedV1, { env: ENV_V2 })).resolves.toEqual(payload);
  });
});

describe("sse byte round-trip", () => {
  beforeEach(() => {
    clearKeyCache();
  });

  it("seals and opens bytes with a header", async () => {
    const payload = bytes(64, 7);
    const sealed = await sealBytes(CONTEXT, payload, { env: ENV });
    const view = new DataView(sealed.buffer, sealed.byteOffset, sealed.byteLength);
    const headerLength = view.getUint32(0, false);
    const header = JSON.parse(
      new TextDecoder().decode(sealed.subarray(4, 4 + headerLength)),
    ) as Record<string, unknown>;
    expect(header.v).toBe(1);
    expect(header.kv).toBe("1");
    expect(header.a).toBe("AES-256-GCM");
    expect(typeof header.i).toBe("string");

    const opened = await openBytes(CONTEXT, sealed, { env: ENV });
    expect(opened).toEqual(payload);
  });

  it("round-trips ~64KB", async () => {
    const payload = bytes(64 * 1024, 11);
    const sealed = await sealBytes(CONTEXT, payload, { env: ENV });
    const opened = await openBytes(CONTEXT, sealed, { env: ENV });
    expect(opened.length).toBe(payload.length);
    expect(opened).toEqual(payload);
  });

  it("rejects tampered bytes", async () => {
    const sealed = await sealBytes(CONTEXT, bytes(32, 3), { env: ENV });
    sealed[sealed.length - 1] = (sealed[sealed.length - 1] ?? 0) ^ 0xff;
    await expect(openBytes(CONTEXT, sealed, { env: ENV })).rejects.toMatchObject({
      code: "decrypt-failed",
    });
  });

  it("rejects bytes opened under the wrong scope", async () => {
    const sealed = await sealBytes(CONTEXT, bytes(16, 5), { env: ENV });
    await expect(
      openBytes({ ...CONTEXT, scope: "other.scope" }, sealed, { env: ENV }),
    ).rejects.toBeInstanceOf(SseError);
  });
});
