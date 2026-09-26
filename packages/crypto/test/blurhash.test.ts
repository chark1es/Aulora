import { describe, expect, it } from "vitest";
import { blurhashDecode, blurhashEncode } from "../src/index.js";

function solid(width: number, height: number, r: number, g: number, b: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 4] = r;
    pixels[index * 4 + 1] = g;
    pixels[index * 4 + 2] = b;
    pixels[index * 4 + 3] = 255;
  }
  return pixels;
}

function average(pixels: Uint8ClampedArray): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  const count = pixels.length / 4;
  for (let index = 0; index < count; index += 1) {
    r += pixels[index * 4] ?? 0;
    g += pixels[index * 4 + 1] ?? 0;
    b += pixels[index * 4 + 2] ?? 0;
  }
  return [r / count, g / count, b / count];
}

describe("blurhash", () => {
  it("encodes a solid color and decodes it back within tolerance", () => {
    const pixels = solid(32, 32, 250, 120, 20);
    const hash = blurhashEncode(pixels, 32, 32);
    expect(hash.length).toBeGreaterThan(6);

    const decoded = blurhashDecode(hash, 16, 16);
    const [r, g, b] = average(decoded);
    expect(Math.abs(r - 250)).toBeLessThan(4);
    expect(Math.abs(g - 120)).toBeLessThan(4);
    expect(Math.abs(b - 20)).toBeLessThan(4);
  });

  it("preserves a two-tone image better than a flat average", () => {
    const width = 32;
    const height = 32;
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const dark = x < width / 2;
        pixels[offset] = dark ? 10 : 240;
        pixels[offset + 1] = dark ? 10 : 240;
        pixels[offset + 2] = dark ? 10 : 240;
        pixels[offset + 3] = 255;
      }
    }
    const hash = blurhashEncode(pixels, width, height);
    const decoded = blurhashDecode(hash, width, height);
    const left = decoded[0] ?? 0;
    const right = decoded[(width - 1) * 4] ?? 0;
    expect(right - left).toBeGreaterThan(100);
  });

  it("is deterministic and produces the canonical alphabet only", () => {
    const pixels = solid(8, 8, 40, 200, 90);
    const first = blurhashEncode(pixels, 8, 8);
    const second = blurhashEncode(pixels, 8, 8);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9A-Za-z#$%*+,\-.:;=?@[\]^_{|}~]+$/);
    expect(first.length).toBe(4 + 2 * 4 * 3);
  });

  it("rejects degenerate dimensions", () => {
    expect(() => blurhashEncode(new Uint8Array(0), 0, 10)).toThrow(/positive/);
    expect(() => blurhashDecode("LEHV6nWB2yk8pyo0adR*.7kCMdnj", 0, 10)).toThrow(/positive/);
  });
});
