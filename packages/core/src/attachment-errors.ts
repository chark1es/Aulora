import { formatBytes } from "./format-bytes";

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

/** Error text the server (or an intermediary such as nginx) uses for oversize files. */
const SIZE_LIMIT_PATTERN =
  /exceeds the upload size cap|over the upload size limit|file is too large|payload too large|request entity too large|entity too large|maximum (allowed )?(file )?size|upload size|\b413\b/i;
/** Signals the request never reached the server (offline, DNS, dropped socket). */
const NETWORK_PATTERN =
  /failed to fetch|networkerror|network error|network request failed|\bload failed\b|\bfetch failed\b|connection|offline|econnrefused|econnreset|timed? ?out/i;

/**
 * Turns an upload failure into safe text that names the actual reason: an
 * over-limit file (with the limit when the error carries it), a connection
 * problem, or a generic fallback. It never falls back to a vague "check
 * the file size" when a specific reason is available.
 */
export function attachmentUploadErrorMessage(
  error: unknown,
  fallback = "Couldn’t upload that attachment.",
): string {
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
    return "Couldn’t reach the workspace to upload that attachment. Check your connection and try again.";
  }
  return fallback;
}
