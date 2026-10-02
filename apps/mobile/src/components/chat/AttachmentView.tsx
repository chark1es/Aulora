import { type AttachmentDescriptor, bytesToBase64, downloadAttachment } from "@aulora/core";
import { Button, Spinner, Text } from "@aulora/ui-native";
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

/**
 * Previews images, plays audio and video inline, and saves or opens any
 * downloaded file through the system share sheet.
 */
export function AttachmentView({ runtime, descriptor }: AttachmentViewProps) {
  const [dataUri, setDataUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaUri, setMediaUri] = useState<string | null>(null);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const isImage = descriptor.mime.startsWith("image/");
  const media = descriptor.mime.startsWith("audio/")
    ? "audio"
    : descriptor.mime.startsWith("video/")
      ? "video"
      : null;
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

  /** Downloads the decrypted bytes into the cache and returns the file's URI. */
  async function cacheFile(port: ChatSurfaceRuntime["port"]): Promise<string> {
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

  async function share() {
    if (runtime === undefined || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await Sharing.isAvailableAsync()))
        throw new Error("File sharing is unavailable on this device.");
      await Sharing.shareAsync(mediaUri ?? (await cacheFile(runtime.port)), {
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
      setMediaUri(await cacheFile(runtime.port));
    } catch {
      setError(`Couldn't load ${descriptor.name}. Try again.`);
    } finally {
      setLoadingMedia(false);
    }
  }
  return (
    <View className="gap-2">
      {isImage && dataUri !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Preview ${descriptor.name}`}
          onPress={() => {
            setPreview(true);
          }}
        >
          <Image
            source={{ uri: dataUri }}
            accessibilityLabel={descriptor.name}
            resizeMode="contain"
            style={{ width: "100%", maxWidth: 320, height: 180, borderRadius: 12 }}
          />
        </Pressable>
      ) : (
        <Text>{failed ? `Couldn't load ${descriptor.name}` : descriptor.name}</Text>
      )}
      {mediaUri !== null && media === "audio" && (
        <AudioPlayback uri={mediaUri} name={descriptor.name} />
      )}
      {mediaUri !== null && media === "video" && (
        <VideoPlayback uri={mediaUri} name={descriptor.name} />
      )}
      <View className="flex-row flex-wrap items-center gap-2">
        <Text size="sm" tone="muted">
          {formatBytes(descriptor.size)}
        </Text>
        {media !== null && mediaUri === null && (
          <Button
            size="sm"
            disabled={runtime === undefined}
            loading={loadingMedia}
            accessibilityLabel={`Play ${descriptor.name}`}
            onPress={() => void loadMedia()}
          >
            Play
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          disabled={runtime === undefined}
          loading={busy}
          onPress={() => void share()}
        >
          Share or save file
        </Button>
      </View>
      {error !== null && (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      )}
      {preview && (
        <Sheet
          visible
          title={descriptor.name}
          dismiss="done"
          onClose={() => {
            setPreview(false);
          }}
        >
          <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
            {dataUri !== null ? (
              <Image
                source={{ uri: dataUri }}
                accessibilityLabel={descriptor.name}
                resizeMode="contain"
                style={{ width: "100%", height: 420 }}
              />
            ) : (
              <Spinner label="Loading image" />
            )}
            <Button loading={busy} onPress={() => void share()}>
              Share or save image
            </Button>
          </ScrollView>
        </Sheet>
      )}
    </View>
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
