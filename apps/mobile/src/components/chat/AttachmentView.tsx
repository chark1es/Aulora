import { type AttachmentDescriptor, bytesToBase64, downloadAttachment } from "@aulora/core";
import { Button, Text } from "@aulora/ui-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";
import type { ChatSurfaceRuntime } from "../../lib/chat-surface";
import { Sheet } from "./Sheet";

export interface AttachmentViewProps {
  readonly runtime: ChatSurfaceRuntime | undefined;
  readonly descriptor: AttachmentDescriptor;
}

/** Downloads the decrypted bytes into the cache and returns the file's URI. */
async function cacheAttachmentFile(
  port: ChatSurfaceRuntime["port"],
  descriptor: AttachmentDescriptor,
): Promise<string> {
  const bytes = await downloadAttachment(port, descriptor);
  const directory = new Directory(
    Paths.cache,
    "shared-attachments",
    descriptor.fileId.replace(/[^a-zA-Z0-9_-]/g, "_"),
  );
  directory.create({ idempotent: true, intermediates: true });
  const file = new File(
    directory,
    descriptor.name
      .replace(/[^\p{L}\p{N} ._-]/gu, "_")
      .replace(/^\.+/, "")
      .slice(0, 160) || "attachment",
  );
  file.write(bytes);
  return file.uri;
}

function useAttachmentPreview(
  runtime: ChatSurfaceRuntime | undefined,
  descriptor: AttachmentDescriptor,
  isImage: boolean,
) {
  const [dataUri, setDataUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaUri, setMediaUri] = useState<string | null>(null);
  const [loadingMedia, setLoadingMedia] = useState(false);

  useEffect(() => {
    setDataUri(null);
    setFailed(false);
    setMediaUri(null);
    if (runtime === undefined || !isImage) return;
    let cancelled = false;
    void downloadAttachment(runtime.port, descriptor)
      .then((bytes) => {
        if (!cancelled) setDataUri(`data:${descriptor.mime};base64,${bytesToBase64(bytes)}`);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, descriptor, isImage]);

  async function share() {
    if (runtime === undefined || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await Sharing.isAvailableAsync()))
        throw new Error("File sharing is unavailable on this device.");
      await Sharing.shareAsync(mediaUri ?? (await cacheAttachmentFile(runtime.port, descriptor)), {
        mimeType: descriptor.mime,
        dialogTitle: descriptor.name,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't download this file. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function loadMedia() {
    if (runtime === undefined || loadingMedia) return;
    setLoadingMedia(true);
    setError(null);
    try {
      setMediaUri(await cacheAttachmentFile(runtime.port, descriptor));
    } catch {
      setError(`Couldn't load ${descriptor.name}. Try again.`);
    } finally {
      setLoadingMedia(false);
    }
  }

  return { dataUri, failed, busy, error, mediaUri, loadingMedia, share, loadMedia };
}

function AttachmentActions(props: {
  readonly runtime: ChatSurfaceRuntime | undefined;
  readonly size: number;
  readonly media: "audio" | "video" | null;
  readonly mediaLoaded: boolean;
  readonly busy: boolean;
  readonly loadingMedia: boolean;
  readonly onLoadMedia: () => void;
  readonly onShare: () => void;
}) {
  const { runtime, size, media, mediaLoaded, busy, loadingMedia, onLoadMedia, onShare } = props;
  return (
    <View className="flex-row flex-wrap items-center gap-2">
      <Text size="sm" tone="muted">
        {formatBytes(size)}
      </Text>
      {media !== null && !mediaLoaded && (
        <Button
          size="sm"
          disabled={runtime === undefined}
          loading={loadingMedia}
          accessibilityLabel="Play attachment"
          onPress={onLoadMedia}
        >
          Play
        </Button>
      )}
      <Button
        variant="secondary"
        size="sm"
        disabled={runtime === undefined}
        loading={busy}
        onPress={onShare}
      >
        Share or save file
      </Button>
    </View>
  );
}

function AttachmentThumb({
  isImage,
  dataUri,
  failed,
  name,
  onPreview,
}: {
  readonly isImage: boolean;
  readonly dataUri: string | null;
  readonly failed: boolean;
  readonly name: string;
  readonly onPreview: () => void;
}) {
  if (isImage && dataUri !== null) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Preview ${name}`}
        onPress={onPreview}
      >
        <Image
          source={{ uri: dataUri }}
          accessibilityLabel={name}
          resizeMode="contain"
          style={{ width: "100%", maxWidth: 320, height: 180, borderRadius: 12 }}
        />
      </Pressable>
    );
  }
  return <Text>{failed ? `Couldn't load ${name}` : name}</Text>;
}

function AttachmentMedia({
  mediaUri,
  media,
  name,
}: {
  readonly mediaUri: string | null;
  readonly media: "audio" | "video" | null;
  readonly name: string;
}) {
  if (mediaUri === null) {
    return null;
  }
  if (media === "audio") {
    return <AudioPlayback uri={mediaUri} name={name} />;
  }
  if (media === "video") {
    return <VideoPlayback uri={mediaUri} name={name} />;
  }
  return null;
}

/** Previews images, plays audio and video inline, and saves or opens any downloaded file. */
export function AttachmentView({ runtime, descriptor }: AttachmentViewProps) {
  const [preview, setPreview] = useState(false);
  const isImage = descriptor.mime.startsWith("image/");
  const media = descriptor.mime.startsWith("audio/")
    ? "audio"
    : descriptor.mime.startsWith("video/")
      ? "video"
      : null;
  const { dataUri, failed, busy, error, mediaUri, loadingMedia, share, loadMedia } =
    useAttachmentPreview(runtime, descriptor, isImage);
  return (
    <View className="gap-2">
      <AttachmentThumb
        isImage={isImage}
        dataUri={dataUri}
        failed={failed}
        name={descriptor.name}
        onPreview={() => {
          setPreview(true);
        }}
      />
      <AttachmentMedia mediaUri={mediaUri} media={media} name={descriptor.name} />
      <AttachmentActions
        runtime={runtime}
        size={descriptor.size}
        media={media}
        mediaLoaded={mediaUri !== null}
        busy={busy}
        loadingMedia={loadingMedia}
        onLoadMedia={() => void loadMedia()}
        onShare={() => void share()}
      />
      {error !== null && (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      )}
      {preview && dataUri !== null && (
        <AttachmentPreview
          dataUri={dataUri}
          name={descriptor.name}
          busy={busy}
          onShare={() => void share()}
          onClose={() => {
            setPreview(false);
          }}
        />
      )}
    </View>
  );
}

function AttachmentPreview({
  dataUri,
  name,
  busy,
  onShare,
  onClose,
}: {
  readonly dataUri: string;
  readonly name: string;
  readonly busy: boolean;
  readonly onShare: () => void;
  readonly onClose: () => void;
}) {
  return (
    <Sheet visible title={name} dismiss="done" onClose={onClose}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Image
          source={{ uri: dataUri }}
          accessibilityLabel={name}
          resizeMode="contain"
          style={{ width: "100%", height: 420 }}
        />
        <Button loading={busy} onPress={onShare}>
          Share or save image
        </Button>
      </ScrollView>
    </Sheet>
  );
}

/** Plays a cached audio file as soon as it mounts; the row pauses and resumes it. */
function AudioPlayback({ uri, name }: { readonly uri: string; readonly name: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  useEffect(() => {
    player.play();
  }, [player]);
  const finished = status.duration > 0 && status.currentTime >= status.duration;
  return (
    <View className="flex-row flex-wrap items-center gap-3">
      <Button
        variant="secondary"
        size="sm"
        accessibilityLabel={`${status.playing ? "Pause" : "Play"} ${name}`}
        onPress={() => {
          if (status.playing) {
            player.pause();
            return;
          }
          if (finished) void player.seekTo(0);
          player.play();
        }}
      >
        {status.playing ? "Pause" : "Play"}
      </Button>
      <Text size="sm" tone="muted" accessibilityLabel="Playback position">
        {formatTime(status.currentTime)} / {formatTime(status.duration)}
      </Text>
    </View>
  );
}

/** Shows a cached video inline with the system playback controls. */
function VideoPlayback({ uri, name }: { readonly uri: string; readonly name: string }) {
  const player = useVideoPlayer(uri, (created) => {
    created.play();
  });
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      accessibilityLabel={name}
      style={{ width: "100%", maxWidth: 320, height: 180, borderRadius: 12 }}
    />
  );
}

function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
