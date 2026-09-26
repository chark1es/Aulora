import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_IV_BYTES,
  ATTACHMENT_KEY_BYTES,
  decryptAttachmentBytes,
  encryptAttachmentBytes,
  generateAttachmentKey,
  parseAttachmentDescriptor,
  sealAttachmentBytes,
} from "../src/index.js";

function bytes(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    out[index] = (index * 31 + seed) % 256;
  }
  return out;
}

describe("attachment envelope", () => {
  it("round-trips bytes through a fresh per-file key", async () => {
    const plaintext = bytes(4096, 7);
    const sealed = await sealAttachmentBytes(plaintext);
    expect(sealed.ciphertext).not.toEqual(plaintext);
    const opened = await decryptAttachmentBytes(sealed.ciphertext, sealed.key, sealed.iv);
    expect(opened).toEqual(plaintext);
  });

  it("generates a 256-bit key and 96-bit IV, never reused", () => {
    const first = generateAttachmentKey();
    const second = generateAttachmentKey();
    expect(atob(first.key).length).toBe(ATTACHMENT_KEY_BYTES);
    expect(atob(first.iv).length).toBe(ATTACHMENT_IV_BYTES);
    expect(first).not.toEqual(second);
  });

  it("is deterministic for the same key and IV", async () => {
    const plaintext = bytes(64, 3);
    const { key, iv } = generateAttachmentKey();
    const a = await encryptAttachmentBytes(plaintext, key, iv);
    const b = await encryptAttachmentBytes(plaintext, key, iv);
    expect(a).toEqual(b);
  });

  it("rejects a tampered ciphertext (AES-GCM integrity)", async () => {
    const sealed = await sealAttachmentBytes(bytes(128, 5));
    sealed.ciphertext[0] = (sealed.ciphertext[0] ?? 0) ^ 0xff;
    await expect(
      decryptAttachmentBytes(sealed.ciphertext, sealed.key, sealed.iv),
    ).rejects.toBeInstanceOf(Error);
  });

  it("rejects the wrong key", async () => {
    const sealed = await sealAttachmentBytes(bytes(128, 9));
    const other = generateAttachmentKey();
    await expect(
      decryptAttachmentBytes(sealed.ciphertext, other.key, sealed.iv),
    ).rejects.toBeInstanceOf(Error);
  });

  it("rejects malformed key and IV lengths", async () => {
    const sealed = await sealAttachmentBytes(bytes(16));
    await expect(
      decryptAttachmentBytes(sealed.ciphertext, btoa("short"), sealed.iv),
    ).rejects.toThrow(/key length/);
    await expect(
      decryptAttachmentBytes(sealed.ciphertext, sealed.key, btoa("tiny")),
    ).rejects.toThrow(/iv length/);
  });
});

describe("attachment descriptor integrity", () => {
  const ref = { fileId: "file-1", ...generateAttachmentKey() };

  it("parses a complete image descriptor with a thumbnail", () => {
    const thumb = generateAttachmentKey();
    const value = {
      fileId: "file-full",
      key: ref.key,
      iv: ref.iv,
      mime: "image/png",
      name: "holiday.png",
      size: 4096,
      dimensions: { width: 1024, height: 768 },
      blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
      thumbnail: {
        fileId: "file-thumb",
        key: thumb.key,
        iv: thumb.iv,
        width: 128,
        height: 96,
        blurhash: "L6PZfSi_.AyE_3t7t7R**0o#DgR4",
      },
    };
    const parsed = parseAttachmentDescriptor(value);
    expect(parsed).not.toBeNull();
    expect(parsed?.name).toBe("holiday.png");
    expect(parsed?.dimensions).toEqual({ width: 1024, height: 768 });
    expect(parsed?.thumbnail?.fileId).toBe("file-thumb");
    expect(parsed?.thumbnail?.width).toBe(128);
  });

  it("rejects a descriptor with a wrong-sized key or IV", () => {
    expect(parseAttachmentDescriptor({ ...ref, key: btoa("short"), iv: ref.iv })).toBeNull();
    expect(parseAttachmentDescriptor({ ...ref, iv: btoa("short"), key: ref.key })).toBeNull();
  });

  it("rejects a descriptor missing required fields or with non-base64 secrets", () => {
    expect(parseAttachmentDescriptor(null)).toBeNull();
    expect(parseAttachmentDescriptor({ ...ref, name: "x" })).toBeNull();
    expect(parseAttachmentDescriptor({ ...ref, key: "***not-base64***" })).toBeNull();
    expect(parseAttachmentDescriptor("nope")).toBeNull();
  });

  it("ignores a malformed thumbnail and does not throw", () => {
    const value = { ...ref, mime: "image/png", name: "x.png", size: 10, thumbnail: 42 };
    expect(() => parseAttachmentDescriptor(value)).not.toThrow();
    const parsed = parseAttachmentDescriptor(value);
    expect(parsed).not.toBeNull();
    expect(parsed?.thumbnail).toBeUndefined();
  });
});
