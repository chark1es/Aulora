import { describe, expect, it } from "vitest";
import { createMockPort } from "../src/chat/testing.js";
import { downloadAttachment, downloadThumbnail, uploadEncryptedAttachment } from "../src/index.js";

function bytes(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    out[index] = (index * 17 + seed) % 256;
  }
  return out;
}

describe("encrypted attachment upload/download", () => {
  it("uploads only ciphertext and returns a descriptor with the key", async () => {
    const port = createMockPort();
    const plaintext = bytes(2048, 3);
    const descriptor = await uploadEncryptedAttachment(port, {
      bytes: plaintext,
      name: "report.pdf",
      mime: "application/pdf",
    });

    expect(descriptor.name).toBe("report.pdf");
    expect(descriptor.mime).toBe("application/pdf");
    expect(descriptor.size).toBeGreaterThan(plaintext.length);

    // The server stored opaque metadata only: no plaintext name/mime.
    const stored = port.state.files.get(descriptor.fileId);
    expect(stored?.nameCiphertext).toBeNull();
    expect(stored?.mimeCiphertext).toBeNull();
    expect(stored?.sizeBytes).toBe(descriptor.size);

    // The stored blob is not the plaintext.
    const storedBytes = port.state.blobs.get(`blob://${descriptor.fileId}`);
    expect(storedBytes).not.toEqual(plaintext);

    const downloaded = await downloadAttachment(port, descriptor);
    expect(downloaded).toEqual(plaintext);
  });

  it("round-trips an image with an encrypted thumbnail and blurhash", async () => {
    const port = createMockPort();
    const full = bytes(4096, 5);
    const thumb = bytes(512, 9);
    const descriptor = await uploadEncryptedAttachment(port, {
      bytes: full,
      name: "holiday.png",
      mime: "image/png",
      dimensions: { width: 800, height: 600 },
      blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
      thumbnail: { bytes: thumb, width: 160, height: 120, blurhash: "L6PZfSi_.AyE" },
    });

    expect(descriptor.dimensions).toEqual({ width: 800, height: 600 });
    expect(descriptor.thumbnail?.width).toBe(160);
    expect(descriptor.thumbnail?.fileId).not.toBe(descriptor.fileId);

    expect(await downloadAttachment(port, descriptor)).toEqual(full);
    expect(await downloadThumbnail(port, descriptor)).toEqual(thumb);
  });

  it("fails to download when the server file is gone", async () => {
    const port = createMockPort();
    const descriptor = await uploadEncryptedAttachment(port, {
      bytes: bytes(16),
      name: "x.bin",
      mime: "application/octet-stream",
    });
    port.state.files.delete(descriptor.fileId);
    await expect(downloadAttachment(port, descriptor)).rejects.toThrow(/no longer available/);
  });

  it("returns undefined for a descriptor without a thumbnail", async () => {
    const port = createMockPort();
    const descriptor = await uploadEncryptedAttachment(port, {
      bytes: bytes(16),
      name: "x.txt",
      mime: "text/plain",
    });
    expect(await downloadThumbnail(port, descriptor)).toBeUndefined();
  });
});
