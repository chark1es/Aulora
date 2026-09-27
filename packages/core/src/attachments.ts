/**
 * High-level attachment flow shared by every client.
 *
 * Bytes and metadata cross the port as plaintext; the server seals them at
 * rest with its External Key Manager. Uploads return the
 * {@link AttachmentDescriptor} the caller embeds in a message body, and
 * downloads reverse the flow through a signed server URL.
 */

import type {
  AttachmentDescriptor,
  AttachmentDimensions,
  AttachmentThumbnail,
  ChatPort,
} from "./chat/port.js";

export interface UploadAttachmentInput {
  readonly bytes: Uint8Array;
  readonly name: string;
  readonly mime: string;
  /** Plaintext byte length; defaults to `bytes.length` when omitted. */
  readonly size?: number;
  readonly dimensions?: AttachmentDimensions;
  readonly blurhash?: string;
  readonly channelId?: string;
}

/**
 * Uploads one attachment, returning the descriptor to embed in a message
 * payload. The server is responsible for sealing the bytes and metadata.
 */
export async function uploadAttachment(
  port: ChatPort,
  input: UploadAttachmentInput,
): Promise<AttachmentDescriptor> {
  const fileId = await port.uploadFile({
    name: input.name,
    mime: input.mime,
    bytes: input.bytes,
    ...(input.dimensions !== undefined ? { dimensions: input.dimensions } : {}),
    ...(input.blurhash !== undefined ? { blurhash: input.blurhash } : {}),
    ...(input.channelId !== undefined ? { channelId: input.channelId } : {}),
  });
  return {
    fileId,
    name: input.name,
    mime: input.mime,
    size: input.size ?? input.bytes.length,
    ...(input.dimensions !== undefined ? { dimensions: input.dimensions } : {}),
    ...(input.blurhash !== undefined ? { blurhash: input.blurhash } : {}),
  };
}

/** Fetches the full attachment bytes. */
export async function downloadAttachment(
  port: ChatPort,
  descriptor: AttachmentDescriptor,
): Promise<Uint8Array> {
  return await port.downloadFile({ fileId: descriptor.fileId });
}

/** Fetches the thumbnail bytes, when the descriptor carries one. */
export async function downloadThumbnail(
  port: ChatPort,
  descriptor: AttachmentDescriptor,
): Promise<Uint8Array | undefined> {
  if (descriptor.thumbnail === undefined) {
    return undefined;
  }
  return await port.downloadFile({ fileId: descriptor.thumbnail.fileId });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseDimensions(value: unknown): AttachmentDimensions | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const width = value.width;
  const height = value.height;
  if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) {
    return undefined;
  }
  return { width, height };
}

function parseThumbnail(value: unknown): AttachmentThumbnail | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const fileId = readString(value.fileId);
  const width = value.width;
  const height = value.height;
  if (fileId === undefined || typeof width !== "number" || typeof height !== "number") {
    return undefined;
  }
  const blurhash = readString(value.blurhash);
  return { fileId, width, height, ...(blurhash !== undefined ? { blurhash } : {}) };
}

/**
 * Validates an untrusted descriptor decoded from a message payload. Returns
 * `null` (never throws) when the shape is wrong. Unknown legacy fields such as
 * `key`/`iv` from the previous client-side encryption are ignored.
 */
export function parseAttachmentDescriptor(value: unknown): AttachmentDescriptor | null {
  if (!isRecord(value)) {
    return null;
  }
  const fileId = readString(value.fileId);
  const name = readString(value.name);
  const mime = readString(value.mime);
  const size = typeof value.size === "number" && value.size >= 0 ? value.size : null;
  if (fileId === undefined || name === undefined || mime === undefined || size === null) {
    return null;
  }
  const dimensions = parseDimensions(value.dimensions);
  const blurhash = readString(value.blurhash);
  const thumbnail = parseThumbnail(value.thumbnail);
  return {
    fileId,
    name,
    mime,
    size,
    ...(dimensions !== undefined ? { dimensions } : {}),
    ...(blurhash !== undefined ? { blurhash } : {}),
    ...(thumbnail !== undefined ? { thumbnail } : {}),
  };
}
