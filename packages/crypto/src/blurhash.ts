/**
 * Blurhash encode/decode over raw RGBA pixels.
 *
 * Pure functions with no canvas or DOM dependency, so the encoder is fully
 * testable headlessly. The web client extracts pixels from a canvas (see
 * `apps/web/src/lib/image.ts`), strips EXIF by re-encoding through that canvas,
 * and stores the resulting hash as an opaque placeholder inside the
 * MLS-encrypted attachment descriptor so the server never sees image content.
 *
 * Ported from the reference implementation (MIT, woltapp/blurhash).
 */

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

function encode83(value: number, length: number): string {
  let result = "";
  for (let index = 1; index <= length; index += 1) {
    const digit = Math.floor(value / 83 ** (length - index)) % 83;
    result += ALPHABET[digit];
  }
  return result;
}

function decode83(value: string): number {
  let result = 0;
  for (const character of value) {
    const digit = ALPHABET.indexOf(character);
    if (digit < 0) {
      throw new Error("invalid blurhash character");
    }
    result = result * 83 + digit;
  }
  return result;
}

function srgbToLinear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const channel = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(channel * 255)));
}

function signPow(value: number, exponent: number): number {
  return Math.sign(value) * Math.abs(value) ** exponent;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function encodeDc(r: number, g: number, b: number): number {
  return (linearToSrgb(r) << 16) + (linearToSrgb(g) << 8) + linearToSrgb(b);
}

function decodeDc(value: number): [number, number, number] {
  return [srgbToLinear(value >> 16), srgbToLinear((value >> 8) & 255), srgbToLinear(value & 255)];
}

/** Encodes RGBA pixels into a blurhash string. */
export function blurhashEncode(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  componentsX = 4,
  componentsY = 3,
): string {
  if (width <= 0 || height <= 0) {
    throw new Error("blurhashEncode: width and height must be positive");
  }
  if (pixels.length < width * height * 4) {
    throw new Error("blurhashEncode: pixel buffer is smaller than width*height*4");
  }
  const componentX = clamp(Math.trunc(componentsX), 1, 9);
  const componentY = clamp(Math.trunc(componentsY), 1, 9);

  const factors: number[] = [];
  for (let y = 0; y < componentY; y += 1) {
    for (let x = 0; x < componentX; x += 1) {
      const normalisation = x === 0 && y === 0 ? 1 : 2;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < width; i += 1) {
        for (let j = 0; j < height; j += 1) {
          const basis = Math.cos((Math.PI * x * i) / width) * Math.cos((Math.PI * y * j) / height);
          const offset = (j * width + i) * 4;
          r += basis * srgbToLinear(pixels[offset] ?? 0);
          g += basis * srgbToLinear(pixels[offset + 1] ?? 0);
          b += basis * srgbToLinear(pixels[offset + 2] ?? 0);
        }
      }
      const scale = normalisation / (width * height);
      factors.push(r * scale, g * scale, b * scale);
    }
  }

  const sizeFlag = componentX - 1 + (componentY - 1) * 9;
  let hash = encode83(sizeFlag, 1);

  const maximumValue = Math.max(...factors.map((factor) => Math.abs(factor)));
  const quantisedMaximumValue = clamp(Math.round(maximumValue * 166 - 0.5), 0, 82);
  hash += encode83(quantisedMaximumValue, 1);
  const actualMaximumValue = (quantisedMaximumValue + 1) / 166;

  hash += encode83(encodeDc(factors[0] ?? 0, factors[1] ?? 0, factors[2] ?? 0), 4);

  for (let index = 1; index < factors.length / 3; index += 1) {
    const quantR = clamp(
      Math.floor(signPow((factors[index * 3] ?? 0) / actualMaximumValue, 0.5) * 9 + 9.5),
      0,
      18,
    );
    const quantG = clamp(
      Math.floor(signPow((factors[index * 3 + 1] ?? 0) / actualMaximumValue, 0.5) * 9 + 9.5),
      0,
      18,
    );
    const quantB = clamp(
      Math.floor(signPow((factors[index * 3 + 2] ?? 0) / actualMaximumValue, 0.5) * 9 + 9.5),
      0,
      18,
    );
    hash += encode83(quantR * 19 * 19 + quantG * 19 + quantB, 2);
  }

  return hash;
}

/** Decodes a blurhash into RGBA pixels of the requested size. */
export function blurhashDecode(
  hash: string,
  width: number,
  height: number,
  punch = 1,
): Uint8ClampedArray {
  if (width <= 0 || height <= 0) {
    throw new Error("blurhashDecode: width and height must be positive");
  }
  if (hash.length < 6) {
    throw new Error("blurhashDecode: hash is too short");
  }
  const sizeFlag = decode83(hash[0] ?? "0");
  const numY = Math.floor(sizeFlag / 9) + 1;
  const numX = (sizeFlag % 9) + 1;
  const quantisedMaximumValue = decode83(hash[1] ?? "0");
  const maximumValue = (quantisedMaximumValue + 1) / 166;

  const colors: [number, number, number][] = [];
  for (let index = 0; index < numX * numY; index += 1) {
    if (index === 0) {
      colors.push(decodeDc(decode83(hash.substring(2, 6))));
    } else {
      const value = decode83(hash.substring(4 + index * 2, 6 + index * 2));
      const quantR = Math.floor(value / (19 * 19));
      const quantG = Math.floor(value / 19) % 19;
      const quantB = value % 19;
      const scale = maximumValue * punch;
      colors.push([
        signPow((quantR - 9) / 9, 2) * scale,
        signPow((quantG - 9) / 9, 2) * scale,
        signPow((quantB - 9) / 9, 2) * scale,
      ]);
    }
  }

  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < numY; j += 1) {
        for (let i = 0; i < numX; i += 1) {
          const basis = Math.cos((Math.PI * i * x) / width) * Math.cos((Math.PI * j * y) / height);
          const color = colors[i + j * numX];
          if (color === undefined) {
            continue;
          }
          r += color[0] * basis;
          g += color[1] * basis;
          b += color[2] * basis;
        }
      }
      const offset = (y * width + x) * 4;
      pixels[offset] = linearToSrgb(r);
      pixels[offset + 1] = linearToSrgb(g);
      pixels[offset + 2] = linearToSrgb(b);
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}
