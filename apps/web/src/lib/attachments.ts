import {
  type AttachmentDescriptor,
  type ChatPort,
  downloadAttachment,
  downloadThumbnail,
  uploadEncryptedAttachment,
} from "@aulora/core";
import { processAttachmentFile } from "./image";

/**
 * Processes and encrypts picked files, then uploads only ciphertext. Images are
 * EXIF-stripped and thumbnailed in the browser before encryption. Returns the
 * descriptors to embed in the MLS message payload.
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
        await uploadEncryptedAttachment(port, {
          bytes: processed.bytes,
          name: processed.name,
          mime: processed.mime,
          dimensions: { width: processed.width, height: processed.height },
          blurhash: processed.blurhash,
          thumbnail: {
            bytes: processed.thumbnail.bytes,
            width: processed.thumbnail.width,
            height: processed.thumbnail.height,
            blurhash: processed.thumbnail.blurhash,
          },
        }),
      );
    } else {
      descriptors.push(
        await uploadEncryptedAttachment(port, {
          bytes: processed.bytes,
          name: processed.name,
          mime: processed.mime,
        }),
      );
    }
  }
  return descriptors;
}

/** Fetches and decrypts the full attachment into a local object URL. */
export async function loadAttachmentUrl(
  port: ChatPort,
  descriptor: AttachmentDescriptor,
): Promise<string> {
  const bytes = await downloadAttachment(port, descriptor);
  return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: descriptor.mime }));
}

/** Fetches and decrypts the thumbnail into a local object URL, when present. */
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
