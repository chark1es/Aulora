import { describe, expect, it } from "vitest";
import { createMockPort } from "../src/chat/testing.js";
import {
  downloadAttachment,
  downloadThumbnail,
  parseAttachmentDescriptor,
  uploadAttachment,
} from "../src/index.js";

function bytes(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    out[index] = (index * 17 + seed) % 256;
  }
  return out;
}

describe("attachment upload/download", () => {
  it("uploads plaintext and returns a plaintext descriptor", async () => {
    const port = createMockPort();
    const plaintext = bytes(2048, 3);
    const descriptor = await uploadAttachment(port, {
      bytes: plaintext,
      name: "report.pdf",
      mime: "application/pdf",
    });

    expect(descriptor.name).toBe("report.pdf");
    expect(descriptor.mime).toBe("application/pdf");
    expect(descriptor.size).toBe(plaintext.length);

    const stored = port.state.files.get(descriptor.fileId);
    expect(stored?.name).toBe("report.pdf");
    expect(stored?.mime).toBe("application/pdf");
    expect(stored?.sizeBytes).toBe(plaintext.length);

    expect(await downloadAttachment(port, descriptor)).toEqual(plaintext);
  });

  it("round-trips image dimensions and blurhash", async () => {
    const port = createMockPort();
    const full = bytes(4096, 5);
    const descriptor = await uploadAttachment(port, {
      bytes: full,
      name: "holiday.png",
      mime: "image/png",
      dimensions: { width: 800, height: 600 },
      blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
    });

    expect(descriptor.dimensions).toEqual({ width: 800, height: 600 });
    expect(descriptor.blurhash).toBe("LEHV6nWB2yk8pyo0adR*.7kCMdnj");
    expect(port.state.files.get(descriptor.fileId)?.dimensions).toBe(
      JSON.stringify({ width: 800, height: 600 }),
    );

    expect(await downloadAttachment(port, descriptor)).toEqual(full);
  });

  it("fails to download when the file bytes are gone", async () => {
    const port = createMockPort();
    const descriptor = await uploadAttachment(port, {
      bytes: bytes(16),
      name: "x.bin",
      mime: "application/octet-stream",
    });
    port.state.blobs.delete(descriptor.fileId);
    await expect(downloadAttachment(port, descriptor)).rejects.toThrow(/no longer available/);
  });

  it("returns undefined for a descriptor without a thumbnail", async () => {
    const port = createMockPort();
    const descriptor = await uploadAttachment(port, {
      bytes: bytes(16),
      name: "x.txt",
      mime: "text/plain",
    });
    expect(await downloadThumbnail(port, descriptor)).toBeUndefined();
  });

  it("parses legacy descriptors carrying key/iv, ignoring them", () => {
    const parsed = parseAttachmentDescriptor({
      fileId: "f1",
      key: "a2V5",
      iv: "aXY=",
      name: "x.png",
      mime: "image/png",
      size: 10,
    });
    expect(parsed).toEqual({ fileId: "f1", name: "x.png", mime: "image/png", size: 10 });
  });

  it("rejects malformed descriptors", () => {
    expect(parseAttachmentDescriptor(null)).toBeNull();
    expect(parseAttachmentDescriptor({ fileId: "f1" })).toBeNull();
    expect(parseAttachmentDescriptor({ name: "x", mime: "text/plain", size: 1 })).toBeNull();
  });
});
