import { type AttachmentDescriptor, downloadAttachment } from "@aulora/core";
import { bytesToBase64 } from "@aulora/crypto";
import { Text } from "@aulora/ui-native";
import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import type { MobileChatRuntime } from "../../lib/chat-runtime";

export interface AttachmentViewProps {
  readonly runtime: MobileChatRuntime | undefined;
  readonly descriptor: AttachmentDescriptor;
}

/**
 * Renders one decrypted attachment. Images are downloaded, decrypted and shown
 * inline from a `data:` URI; other files show their name (saving/sharing is a
 * later phase). Decryption happens through the channel's MLS-derived file key.
 */
export function AttachmentView({ runtime, descriptor }: AttachmentViewProps) {
  const [dataUri, setDataUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const isImage = descriptor.mime.startsWith("image/");

  useEffect(() => {
    if (runtime === undefined || !isImage) {
      return;
    }
    let cancelled = false;
    void downloadAttachment(runtime.port, descriptor)
      .then((bytes) => {
        if (!cancelled) {
          setDataUri(`data:${descriptor.mime};base64,${bytesToBase64(bytes)}`);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, descriptor, isImage]);

  if (isImage && dataUri !== null) {
    return (
      <Image
        source={{ uri: dataUri }}
        resizeMode="cover"
        style={{ width: 220, height: 160, borderRadius: 12 }}
      />
    );
  }

  return (
    <View className="flex-row items-center gap-2 rounded-pill border border-border bg-surface-3 px-3 py-1.5">
      <Text size="xs" tone="muted" numberOfLines={1} className="max-w-[12rem]">
        {isImage && failed ? "Could not decrypt image" : descriptor.name}
      </Text>
      <Text size="xs" tone="muted" mono>
        {formatBytes(descriptor.size)}
      </Text>
    </View>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
