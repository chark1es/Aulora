import {
  type AttachmentDescriptor,
  type ChatPort,
  downloadAttachment,
  downloadThumbnail,
  uploadAttachment,
} from "@aulora/core";
import { processAttachmentFile } from "./image";
import { formatBytes } from "./instance-admin";

/**
 * Cap used when the server's public config has not loaded yet (or is
 * unavailable). Mirrors the server-side default so an offline client never
 * blocks an upload the server would accept.
 */
export const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Thrown when a file, after client-side processing, is larger than the upload
 * cap. Carries the numbers so callers can show a specific message.
 */
export class AttachmentSizeError extends Error {
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly maxBytes: number;

  constructor(fileName: string, sizeBytes: number, maxBytes: number) {
    super(`${fileName} is ${formatBytes(sizeBytes)}, over the ${formatBytes(maxBytes)} limit.`);
    this.name = "AttachmentSizeError";
    this.fileName = fileName;
    this.sizeBytes = sizeBytes;
    this.maxBytes = maxBytes;
  }
}

export interface UploadFilesOptions {
  /**
   * Largest allowed processed size in bytes. Omit to skip the client pre-flight
   * check and rely on the server cap alone.
   */
  readonly maxBytes?: number;
}

/** Error text the server (or an intermediary such as nginx) uses for oversize files. */
const SIZE_LIMIT_PATTERN =
  /exceeds the upload size cap|over the upload size limit|file is too large|payload too large|request entity too large|entity too large|maximum (allowed )?(file )?size|upload size|\b413\b/i;
/** Signals the request never reached the server (offline, DNS, dropped socket). */
const NETWORK_PATTERN =
  /failed to fetch|networkerror|network error|network request failed|\bload failed\b|\bfetch failed\b|connection|offline|econnrefused|econnreset|timed? ?out/i;

/**
 * Turns an upload failure into a message that names the actual reason: an
 * over-limit file (with the limit when the error carries it), a connection
 * problem, or the underlying error text. It never falls back to a vague "check
 * the file size" when a specific reason is available.
 */
export function attachmentUploadErrorMessage(error: unknown): string {
  if (error instanceof AttachmentSizeError) {
    return error.message;
  }
  const raw =
    error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : "";
  if (raw.length > 0 && SIZE_LIMIT_PATTERN.test(raw)) {
    const captured = /(\d+)\s*bytes/i.exec(raw)?.[1];
    const limit = captured !== undefined ? ` (${formatBytes(Number(captured))})` : "";
    return `That file is over the upload size limit${limit}.`;
  }
  if (raw.length > 0 && NETWORK_PATTERN.test(raw)) {
    return "Couldn't reach the server to upload that attachment. Check your connection and try again.";
  }
  return raw.length > 0
    ? `Couldn't upload that attachment: ${raw}`
    : "Couldn't upload that attachment.";
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

/** Fetches the thumbnail into a local object URL, when present. */
export async function loadThumbnailUrl(
  port: ChatPort,
  descriptor: AttachmentDescriptor,
): Promise<string | undefined> {
  const bytes = await downloadThumbnail(port, descriptor);
  if (bytes === undefined) {
    return undefined;
  }
  const mime = descriptor.mime === "image/png" ? "image/png" : "image/jpeg";
  return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }));
}
