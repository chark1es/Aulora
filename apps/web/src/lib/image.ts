/**
 * Client-side image preparation: EXIF stripping, re-encoding and thumbnails.
 *
 * Images are re-drawn onto a canvas and re-encoded, which drops EXIF and every
 * other metadata block from the original file; the bytes that are then
 * encrypted and uploaded contain only pixels. A blurhash placeholder and a
 * small thumbnail are produced for progressive display.
 *
 * This module is browser-only (canvas + `createImageBitmap`). The pure helpers
 * (`fitWithin`, `outputMimeFor`, `isProcessableImage`) are unit-tested; the
 * canvas pipeline itself is covered by the live-browser Playwright test.
 */

import { blurhashDecode, blurhashEncode } from "@aulora/crypto";

/** Longest edge of the re-encoded full image. */
export const MAX_IMAGE_EDGE = 4096;
/** Longest edge of the generated thumbnail. */
export const THUMBNAIL_EDGE = 320;
/** Longest edge of the image sampled for the blurhash. */
const BLURHASH_EDGE = 32;

export interface RawAttachmentFile {
  readonly kind: "file";
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly name: string;
}

export interface ProcessedImageAttachment {
  readonly kind: "image";
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly blurhash: string;
  readonly thumbnail: {
    readonly bytes: Uint8Array;
    readonly width: number;
    readonly height: number;
    readonly blurhash: string;
  };
}

export type ProcessedAttachment = RawAttachmentFile | ProcessedImageAttachment;

/** Scales `width`x`height` down so its longest edge is at most `max`. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max || longest === 0) {
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** PNG keeps transparency; everything else becomes a quality-90 JPEG. */
export function outputMimeFor(inputMime: string): "image/png" | "image/jpeg" {
  return inputMime === "image/png" ? "image/png" : "image/jpeg";
}

/** Only raster images the browser can decode are re-encoded. */
export function isProcessableImage(mime: string): boolean {
  return (
    mime === "image/png" ||
    mime === "image/jpeg" ||
    mime === "image/webp" ||
    mime === "image/gif" ||
    mime === "image/bmp"
  );
}

function drawToCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("2D canvas is not available");
  }
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

async function canvasToBytes(
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number,
): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => {
    if (quality === undefined) {
      canvas.toBlob((value) => resolve(value), mime);
    } else {
      canvas.toBlob((value) => resolve(value), mime, quality);
    }
  });
  if (blob === null) {
    throw new Error("Canvas encoding failed");
  }
  return new Uint8Array(await blob.arrayBuffer());
}

function blurhashFrom(source: CanvasImageSource, width: number, height: number): string {
  const target = fitWithin(width, height, BLURHASH_EDGE);
  const canvas = drawToCanvas(source, target.width, target.height);
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("2D canvas is not available");
  }
  const image = context.getImageData(0, 0, target.width, target.height);
  return blurhashEncode(image.data, target.width, target.height);
}

/** Renders a blurhash to a data URL for use as an inline placeholder. */
export function blurhashToDataUrl(hash: string, width = 32, height = 32): string | undefined {
  try {
    const pixels = blurhashDecode(hash, width, height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) {
      return undefined;
    }
    context.putImageData(
      new ImageData(pixels as unknown as Uint8ClampedArray<ArrayBuffer>, width, height),
      0,
      0,
    );
    return canvas.toDataURL("image/png");
  } catch {
    return undefined;
  }
}

/**
 * Reads a picked/dropped file: images are EXIF-stripped, re-encoded and
 * thumbnailed; everything else is returned as raw bytes. The caller then
 * encrypts the result before it can leave the device.
 */
export async function processAttachmentFile(file: File): Promise<ProcessedAttachment> {
  const name = file.name.length > 0 ? file.name : "attachment";
  const mime = file.type.length > 0 ? file.type : "application/octet-stream";

  async function readRaw(): Promise<RawAttachmentFile> {
    return { kind: "file", bytes: new Uint8Array(await file.arrayBuffer()), mime, name };
  }

  if (!isProcessableImage(mime)) {
    return await readRaw();
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return await readRaw();
  }

  try {
    const outputMime = outputMimeFor(mime);
    const quality = outputMime === "image/jpeg" ? 0.9 : undefined;
    const full = fitWithin(bitmap.width, bitmap.height, MAX_IMAGE_EDGE);
    const fullBytes = await canvasToBytes(
      drawToCanvas(bitmap, full.width, full.height),
      outputMime,
      quality,
    );
    const blurhash = blurhashFrom(bitmap, bitmap.width, bitmap.height);
    const thumb = fitWithin(bitmap.width, bitmap.height, THUMBNAIL_EDGE);
    const thumbBytes = await canvasToBytes(
      drawToCanvas(bitmap, thumb.width, thumb.height),
      outputMime,
      quality,
    );
    return {
      kind: "image",
      bytes: fullBytes,
      mime: outputMime,
      name,
      width: full.width,
      height: full.height,
      blurhash,
      thumbnail: { bytes: thumbBytes, width: thumb.width, height: thumb.height, blurhash },
    };
  } finally {
    bitmap.close();
  }
}
