import {
  type AttachmentDescriptor,
  type ChatPort,
  downloadAttachment,
  downloadThumbnail,
  uploadAttachment,
} from "@aulora/core";
import { processAttachmentFile } from "./image";

/**
 * Processes picked files, then uploads plaintext bytes. Images are
 * EXIF-stripped and thumbnailed in the browser before upload; the server seals
 * the bytes and metadata at rest. Returns the descriptors to embed in the
 * message payload.
 */
export async function uploadFiles(
  port: ChatPort,
  files: readonly File[],
): Promise<readonly AttachmentDescriptor[]> {
  const descriptors: AttachmentDescriptor[] = [];
  for (const file of files) {
    const processed = await processAttachmentFile(file);
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
