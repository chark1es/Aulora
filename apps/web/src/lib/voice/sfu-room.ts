/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { SfuAccess, StreamProfile, VoiceDeviceSettings } from "@aulora/core";
import type { DisplayCapture } from "./display";

/**
 * The seam between the call engine and the streaming server. The engine only
 * knows these types; `connectLiveKit` is the one place that touches the
 * `livekit-client` SDK, loaded on demand so a workspace without a streaming
 * server never downloads it.
 */
export interface SfuHandlers {
  /** The screens currently being relayed, keyed by the sharer's user id. */
  onScreens(screens: ReadonlyMap<string, MediaStream>): void;
  /** The connection is gone and the SDK has stopped trying to restore it. */
  onClosed(): void;
}

export interface PublishOptions {
  readonly profile: StreamProfile;
  readonly codec: VoiceDeviceSettings["screenCodec"];
  readonly degradation: RTCDegradationPreference;
}

export interface SfuConnection {
  publish(capture: DisplayCapture, options: PublishOptions): Promise<void>;
  unpublish(): Promise<void>;
  disconnect(): Promise<void>;
}

export type SfuConnector = (access: SfuAccess, handlers: SfuHandlers) => Promise<SfuConnection>;

type LiveKit = typeof import("livekit-client");
type LiveKitRoom = InstanceType<LiveKit["Room"]>;
type LiveKitPublication = Awaited<ReturnType<LiveKitRoom["localParticipant"]["publishTrack"]>>;

type VideoCodecName = "vp8" | "vp9" | "av1" | "h264";

function codecName(codec: PublishOptions["codec"]): VideoCodecName | undefined {
  return codec === "auto" ? undefined : codec;
}

/** Keeps one `MediaStream` per sharer, holding that sharer's screen video and audio. */
class ScreenCollector {
  private readonly streams = new Map<string, MediaStream>();

  constructor(private readonly emit: (screens: ReadonlyMap<string, MediaStream>) => void) {}

  add(identity: string, track: MediaStreamTrack): void {
    const stream = this.streams.get(identity) ?? new MediaStream();
    if (!stream.getTracks().includes(track)) {
      stream.addTrack(track);
    }
    this.streams.set(identity, stream);
    this.emit(new Map(this.streams));
  }

  remove(identity: string, track: MediaStreamTrack): void {
    const stream = this.streams.get(identity);
    if (stream === undefined) {
      return;
    }
    stream.removeTrack(track);
    if (stream.getTracks().length === 0) {
      this.streams.delete(identity);
    }
    this.emit(new Map(this.streams));
  }

  drop(identity: string): void {
    if (this.streams.delete(identity)) {
      this.emit(new Map(this.streams));
    }
  }

  clear(): void {
    this.streams.clear();
    this.emit(new Map());
  }
}

function isScreenSource(livekit: LiveKit, source: string): boolean {
  return (
    source === livekit.Track.Source.ScreenShare || source === livekit.Track.Source.ScreenShareAudio
  );
}

function listen(livekit: LiveKit, room: LiveKitRoom, handlers: SfuHandlers): ScreenCollector {
  const collector = new ScreenCollector((screens) => {
    handlers.onScreens(screens);
  });
  const { RoomEvent } = livekit;
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (isScreenSource(livekit, publication.source)) {
      collector.add(participant.identity, track.mediaStreamTrack);
    }
  });
  room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
    if (isScreenSource(livekit, publication.source)) {
      collector.remove(participant.identity, track.mediaStreamTrack);
    }
  });
  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    collector.drop(participant.identity);
  });
  room.on(RoomEvent.Disconnected, () => {
    collector.clear();
    handlers.onClosed();
  });
  return collector;
}

/**
 * The low simulcast layer's size: half of what is actually sent. The profile is
 * only a ceiling, so a 1080p screen shared under a 4K setting is sent at 1080p,
 * and halving the ceiling would give a "low" layer as large as the top one (a
 * second full-size encode on a smaller budget). The source's own size, fitted
 * into the ceiling, is halved instead; the ceiling stands in when the track
 * does not report a size.
 */
export function lowLayerSize(
  profile: StreamProfile,
  source: { readonly width?: number; readonly height?: number },
): { width: number; height: number } {
  let width = profile.width;
  let height = profile.height;
  if (
    source.width !== undefined &&
    source.height !== undefined &&
    source.width > 0 &&
    source.height > 0
  ) {
    const scale = Math.min(1, profile.width / source.width, profile.height / source.height);
    width = source.width * scale;
    height = source.height * scale;
  }
  return { width: Math.max(2, Math.round(width / 2)), height: Math.max(2, Math.round(height / 2)) };
}

/**
 * A lower simulcast layer so a viewer on a weak link gets a usable picture. It
 * tops out at 30 fps: on a quarter of the bitrate, 60 frames would each be
 * blockier, and the extra encode work is mostly spent on a layer few receive.
 */
const LOW_LAYER_MAX_FRAME_RATE = 30;

/** The low simulcast layer: half the sent size, a quarter of the bitrate. */
function lowLayer(livekit: LiveKit, profile: StreamProfile, track: MediaStreamTrack) {
  const { width, height } = lowLayerSize(profile, track.getSettings());
  return new livekit.VideoPreset(
    width,
    height,
    Math.round(profile.maxBitrate / 4),
    Math.min(LOW_LAYER_MAX_FRAME_RATE, profile.frameRate),
  );
}

async function publishScreen(
  livekit: LiveKit,
  room: LiveKitRoom,
  capture: DisplayCapture,
  options: PublishOptions,
): Promise<LiveKitPublication[]> {
  const { Track, VideoPreset, AudioPresets } = livekit;
  const { profile } = options;
  const top = new VideoPreset(profile.width, profile.height, profile.maxBitrate, profile.frameRate);
  const codec = codecName(options.codec);
  const published: LiveKitPublication[] = [];
  published.push(
    await room.localParticipant.publishTrack(capture.video, {
      source: Track.Source.ScreenShare,
      name: "screen",
      stream: "screen",
      simulcast: true,
      screenShareEncoding: top.encoding,
      screenShareSimulcastLayers: [lowLayer(livekit, profile, capture.video)],
      degradationPreference: options.degradation,
      backupCodec: true,
      ...(codec !== undefined ? { videoCodec: codec } : {}),
    }),
  );
  if (capture.audio !== null) {
    // The picture matters more than the sound: a failed audio publish must not
    // take the stream down.
    try {
      published.push(
        await room.localParticipant.publishTrack(capture.audio, {
          source: Track.Source.ScreenShareAudio,
          name: "screen-audio",
          stream: "screen",
          audioPreset: AudioPresets.musicStereo,
          dtx: false,
          red: false,
        }),
      );
    } catch {
      // Video only.
    }
  }
  return published;
}

export const connectLiveKit: SfuConnector = async (access, handlers) => {
  const livekit = await import("livekit-client");
  const room = new livekit.Room({
    // Viewers draw the stream with their own <video>, which the SDK cannot
    // observe, so size-based layer selection would never switch up.
    adaptiveStream: false,
    // Stop encoding layers nobody is watching.
    dynacast: true,
    // The call engine owns the capture tracks' lifetime.
    stopLocalTrackOnUnpublish: false,
  });
  const collector = listen(livekit, room, handlers);
  await room.connect(access.url, access.token, { autoSubscribe: true });
  let published: LiveKitPublication[] = [];
  return {
    async publish(capture, options) {
      published = await publishScreen(livekit, room, capture, options);
    },
    async unpublish() {
      const tracks = published.flatMap((publication) =>
        publication.track?.mediaStreamTrack === undefined
          ? []
          : [publication.track.mediaStreamTrack],
      );
      published = [];
      for (const track of tracks) {
        await room.localParticipant.unpublishTrack(track, false).catch(() => undefined);
      }
    },
    async disconnect() {
      collector.clear();
      await room.disconnect().catch(() => undefined);
    },
  };
};
