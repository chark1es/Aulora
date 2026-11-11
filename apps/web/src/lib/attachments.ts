import {
  type AttachmentDescriptor,
  AttachmentSizeError,
  type ChatPort,
  downloadAttachment,
  downloadThumbnail,
  uploadAttachment,
} from "@aulora/core";
import { processAttachmentFile } from "./image";

/**
 * Cap used when the server’s public config has not loaded yet (or is
 * unavailable). Mirrors the server-side default so an offline client never
 * blocks an upload the server would accept.
 */
export const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export { AttachmentSizeError, attachmentUploadErrorMessage } from "@aulora/core";

export interface UploadFilesOptions {
  /**
   * Largest allowed processed size in bytes. Omit to skip the client pre-flight
   * check and rely on the server cap alone.
   */
  readonly maxBytes?: number;
}

/**
 * Processes picked files, then uploads plaintext bytes. Images are
 * EXIF-stripped and thumbnailed in the browser before upload; the server seals
 * the bytes and metadata at rest. Returns the descriptors to embed in the
 * message payload.
 *
 * When `options.maxBytes` is given, a processed file larger than the cap throws
 * an {@link AttachmentSizeError} before any bytes leave the browser.
 */
export async function uploadFiles(
  port: ChatPort,
  files: readonly File[],
  options: UploadFilesOptions = {},
): Promise<readonly AttachmentDescriptor[]> {
  const { maxBytes } = options;
  const descriptors: AttachmentDescriptor[] = [];
  for (const file of files) {
    const processed = await processAttachmentFile(file);
    if (maxBytes !== undefined && processed.bytes.length > maxBytes) {
      throw new AttachmentSizeError(processed.name, processed.bytes.length, maxBytes);
    }
    if (processed.kind === "image") {
      descriptors.push(
        await uploadAttachment(port, {
          bytes: processed.bytes,
          name: processed.name,
          mime: processed.mime,
          dimensions: { width: processed.width, height: processed.height },
          blurhash: processed.blurhash,
          // Downscaled preview so inline grids never fetch the full original.
          thumbnail: { bytes: processed.thumbnail.bytes },
        }),
      );
    } else {
      descriptors.push(
        await uploadAttachment(port, {
          bytes: processed.bytes,
          name: processed.name,
          mime: processed.mime,
        }),
      );
    }
  }
  return descriptors;
}

/** Fetches the full attachment into a local object URL. */
export async function loadAttachmentUrl(
  port: ChatPort,
  descriptor: AttachmentDescriptor,
): Promise<string> {
  const bytes = await downloadAttachment(port, descriptor);
  return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: descriptor.mime }));
}

/**
 * Fetches the small thumbnail into a local object URL, when present. A server
 * thumbnail carries its own signed `url` (a variant of the parent file), which
 * is fetched directly; legacy descriptors that only carry a `fileId` fall back
 * to downloading through the port.
 */
export async function loadThumbnailUrl(
  port: ChatPort,
  descriptor: AttachmentDescriptor,
): Promise<string | undefined> {
  const mime = descriptor.mime === "image/png" ? "image/png" : "image/jpeg";
  const thumbnailUrl = descriptor.thumbnail?.url;
  if (thumbnailUrl !== undefined) {
    const response = await fetch(thumbnailUrl);
    if (!response.ok) {
      throw new Error(`Thumbnail download failed with status ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }));
  }
  const bytes = await downloadThumbnail(port, descriptor);
  if (bytes === undefined) {
    return undefined;
  }
  return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }));
}
