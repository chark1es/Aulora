// Generates the source app icon and the Windows taskbar overlay badge as PNGs,
// with no image dependencies (Node's zlib only). Run `bun run make:icons` to
// regenerate; `bun run icons` then fans app-icon.png out into the platform icon
// set via the Tauri CLI.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const BG = [0x0a, 0x0a, 0x0c];
const EMBER = [0xf5, 0xa4, 0x5b];
const CLEAR = [0, 0, 0, 0];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBytes, data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function inRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) {
    return false;
  }
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function inArch(x, y, centerX, topCenterY, halfWidth, bottomY) {
  if (y > bottomY) {
    return false;
  }
  if (y >= topCenterY) {
    return Math.abs(x - centerX) <= halfWidth;
  }
  const dx = x - centerX;
  const dy = y - topCenterY;
  return dx * dx + dy * dy <= halfWidth * halfWidth;
}

function inCircle(x, y, centerX, centerY, radius) {
  const dx = x - centerX;
  const dy = y - centerY;
  return dx * dx + dy * dy <= radius * radius;
}

function sampleAppIcon(x, y) {
  if (inRoundedRect(x, y, 64, 64, 960, 960, 220)) {
    if (inArch(x, y, 512, 430, 250, 800)) {
      if (inArch(x, y, 512, 470, 150, 800)) {
        return inCircle(x, y, 512, 610, 52) ? [...EMBER, 255] : [...BG, 255];
      }
      return [...EMBER, 255];
    }
    return [...BG, 255];
  }
  return CLEAR;
}

function sampleBadge(x, y, size) {
  const center = size / 2;
  if (inCircle(x, y, center, center, size * 0.46)) {
    if (inCircle(x, y, center, center, size * 0.36)) {
      return [...EMBER, 255];
    }
    return [...BG, 255];
  }
  return CLEAR;
}

function render(size, sampler, scale) {
  const out = Buffer.alloc(size * size * 4);
  const inv = 1 / (scale * scale);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const px = x + (sx + 0.5) / scale;
          const py = y + (sy + 0.5) / scale;
          const [cr, cg, cb, ca] = sampler(px, py);
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const offset = (y * size + x) * 4;
      if (a === 0) {
        continue;
      }
      out[offset] = Math.round(r / a);
      out[offset + 1] = Math.round(g / a);
      out[offset + 2] = Math.round(b / a);
      out[offset + 3] = Math.round(a * inv);
    }
  }
  return out;
}

function write(relative, buffer) {
  const path = resolve(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
  process.stdout.write(`wrote ${path}\n`);
}

const APP_SIZE = 1024;
write("src-tauri/app-icon.png", encodePng(APP_SIZE, APP_SIZE, render(APP_SIZE, sampleAppIcon, 2)));

const BADGE_SIZE = 64;
write(
  "src-tauri/assets/badge.png",
  encodePng(
    BADGE_SIZE,
    BADGE_SIZE,
    render(BADGE_SIZE, (x, y) => sampleBadge(x, y, BADGE_SIZE), 2),
  ),
);
