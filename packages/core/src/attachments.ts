/**
 * High-level attachment flow shared by every client.
 *
 * Encrypt locally with a fresh per-file AES-GCM key, upload only ciphertext,
 * record opaque metadata, and return the {@link AttachmentDescriptor} that the
 * caller embeds inside the MLS-encrypted message. Downloads reverse the flow.
 * The port boundary never sees a key or plaintext.
 */

import {
  type AttachmentCryptoOptions,
  type AttachmentDescriptor,
  decryptAttachmentBytes,
  sealAttachmentBytes,
} from "@aulora/crypto";
import type { ChatPort, StoredFileView } from "./chat/port.js";

export interface ThumbnailUpload {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly blurhash?: string;
  /** MIME of the thumbnail; defaults to the parent's MIME. */
  readonly mime?: string;
}

export interface UploadAttachmentInput {
  readonly bytes: Uint8Array;
  readonly name: string;
  readonly mime: string;
  readonly dimensions?: { readonly width: number; readonly height: number };
  readonly blurhash?: string;
  readonly thumbnail?: ThumbnailUpload;
  readonly crypto?: Crypto;
}

/**
 * Encrypts and uploads one attachment (plus an optional thumbnail), returning
 * the descriptor to embed in a message payload.
 */
export async function uploadEncryptedAttachment(
  port: ChatPort,
  input: UploadAttachmentInput,
): Promise<AttachmentDescriptor> {
  const options: AttachmentCryptoOptions =
    input.crypto !== undefined ? { crypto: input.crypto } : {};
  const sealed = await sealAttachmentBytes(input.bytes, options);
  const uploadUrl = await port.generateUploadUrl();
  const storageId = await port.uploadCiphertext({ uploadUrl, bytes: sealed.ciphertext });
  const fileId = await port.recordFile({
    storageId,
    sizeBytes: sealed.ciphertext.length,
  });

  let thumbnail: AttachmentDescriptor["thumbnail"] | undefined;
  if (input.thumbnail !== undefined) {
    const sealedThumb = await sealAttachmentBytes(input.thumbnail.bytes, options);
    const thumbUrl = await port.generateUploadUrl();
    const thumbStorage = await port.uploadCiphertext({
      uploadUrl: thumbUrl,
      bytes: sealedThumb.ciphertext,
    });
    const thumbFileId = await port.recordFile({
      storageId: thumbStorage,
      sizeBytes: sealedThumb.ciphertext.length,
    });
    thumbnail = {
      fileId: thumbFileId,
      key: sealedThumb.key,
      iv: sealedThumb.iv,
      width: input.thumbnail.width,
      height: input.thumbnail.height,
      ...(input.thumbnail.blurhash !== undefined ? { blurhash: input.thumbnail.blurhash } : {}),
    };
  }

  return {
    fileId,
    key: sealed.key,
    iv: sealed.iv,
    mime: input.mime,
    name: input.name,
    size: sealed.ciphertext.length,
    ...(input.dimensions !== undefined ? { dimensions: input.dimensions } : {}),
    ...(input.blurhash !== undefined ? { blurhash: input.blurhash } : {}),
    ...(thumbnail !== undefined ? { thumbnail } : {}),
  };
}

async function download(
  port: ChatPort,
  ref: { readonly fileId: string; readonly key: string; readonly iv: string },
): Promise<Uint8Array> {
  const file: StoredFileView | null = await port.getFile({ fileId: ref.fileId });
  if (file === null || file.url === null) {
    throw new Error("attachment is no longer available");
  }
  const ciphertext = await port.fetchCiphertext({ url: file.url });
  return await decryptAttachmentBytes(ciphertext, ref.key, ref.iv);
}

/** Fetches and decrypts the full attachment. */
export async function downloadAttachment(
  port: ChatPort,
  descriptor: AttachmentDescriptor,
): Promise<Uint8Array> {
  return await download(port, descriptor);
}

/** Fetches and decrypts the thumbnail, when present. */
export async function downloadThumbnail(
  port: ChatPort,
  descriptor: AttachmentDescriptor,
): Promise<Uint8Array | undefined> {
  if (descriptor.thumbnail === undefined) {
    return undefined;
  }
  return await download(port, descriptor.thumbnail);
}
