import {
  type AttachmentDescriptor,
  base64ToBytes,
  type ChatPort,
  uploadAttachment,
} from "@aulora/core";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

/**
 * Mobile uploads: camera, photo library, document picker and clipboard paste.
 * Images are re-encoded (which strips EXIF) before upload; the server seals
 * every attachment at rest, so only plaintext crosses the wire.
 */
export interface PickedFile {
  readonly uri: string;
  readonly name: string;
  readonly mime: string;
  readonly width?: number;
  readonly height?: number;
}

const MAX_IMAGE_EDGE = 1920;

async function readBytes(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri);
  return new Uint8Array(await response.arrayBuffer());
}

async function processImage(asset: ImagePicker.ImagePickerAsset): Promise<PickedFile> {
  try {
    const context = ImageManipulator.manipulate(asset.uri);
    if ((asset.width ?? 0) > MAX_IMAGE_EDGE) {
      context.resize({ width: MAX_IMAGE_EDGE });
    }
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.82 });
    return {
      uri: saved.uri,
      name: asset.fileName ?? `photo-${Date.now()}.jpg`,
      mime: "image/jpeg",
      width: saved.width,
      height: saved.height,
    };
  } catch {
    return {
      uri: asset.uri,
      name: asset.fileName ?? `photo-${Date.now()}.jpg`,
      mime: asset.mimeType ?? "image/jpeg",
      ...(asset.width !== undefined ? { width: asset.width } : {}),
      ...(asset.height !== undefined ? { height: asset.height } : {}),
    };
  }
}

export async function pickFromLibrary(): Promise<readonly PickedFile[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 1,
    exif: false,
    allowsMultipleSelection: true,
  });
  if (result.canceled) {
    return [];
  }
  return await Promise.all(result.assets.map(processImage));
}

export async function pickFromCamera(): Promise<PickedFile | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return null;
  }
  const result = await ImagePicker.launchCameraAsync({ quality: 1, exif: false });
  if (result.canceled || result.assets[0] === undefined) {
    return null;
  }
  return await processImage(result.assets[0]);
}

export async function pickDocuments(): Promise<readonly PickedFile[]> {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: true,
  });
  if (result.canceled) {
    return [];
  }
  return result.assets.map((asset) => ({
    uri: asset.uri,
    name: asset.name,
    mime: asset.mimeType ?? "application/octet-stream",
  }));
}

/** Reads an image (not text) from the clipboard, if present. */
export async function pickFromClipboard(): Promise<PickedFile | null> {
  const image = await Clipboard.getImageAsync({ format: "png" });
  if (image === null) {
    return null;
  }
  return {
    uri: image.data,
    name: `pasted-${Date.now()}.png`,
    mime: "image/png",
    width: image.size.width,
    height: image.size.height,
  };
}

function bytesFor(file: PickedFile): Promise<Uint8Array> {
  if (file.uri.startsWith("data:")) {
    const base64 = file.uri.slice(file.uri.indexOf(",") + 1);
    return Promise.resolve(base64ToBytes(base64));
  }
  return readBytes(file.uri);
}

/** Uploads one picked file; returns the descriptor for the payload. */
export async function uploadPickedFile(
  port: ChatPort,
  file: PickedFile,
): Promise<AttachmentDescriptor> {
  const bytes = await bytesFor(file);
  return await uploadAttachment(port, {
    bytes,
    name: file.name,
    mime: file.mime,
    ...(file.width !== undefined && file.height !== undefined
      ? { dimensions: { width: file.width, height: file.height } }
      : {}),
  });
}

/** Uploads several picked files in order. */
export async function uploadPickedFiles(
  port: ChatPort,
  files: readonly PickedFile[],
): Promise<readonly AttachmentDescriptor[]> {
  const descriptors: AttachmentDescriptor[] = [];
  for (const file of files) {
    descriptors.push(await uploadPickedFile(port, file));
  }
  return descriptors;
}
