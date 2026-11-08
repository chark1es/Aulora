/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { SfuAccess } from "@aulora/core";
import type { LocalTrackPublication, RemoteTrack, RemoteVideoTrack, Room } from "livekit-client";
import { createLevelMeter } from "./media";

/**
 * Microphone and camera over the streaming server (LiveKit) for a call that is
 * too large for the peer mesh.
 *
 * This is deliberately separate from `sfu-room.ts` (screen shares): it joins
 * its own room (`call_<id>_media`), subscribes only to microphone and camera,
 * and configures the room for adaptive streaming. The two connections can
 * coexist because they use different rooms, so a device does not have to give
 * up its screen share to use the call transport.
 *
 * Encoding choices:
 *  - microphone: ~32 kbps Opus with DTX and RED, so silence costs nothing and
 *    a lossy link gets redundant audio;
 *  - camera: three simulcast layers (1080p30/2.5 Mbps, 540p15/700 kbps,
 *    270p15/200 kbps) with `dynacast`, so the publisher sends only the layers
 *    someone is watching;
 *  - subscribers: `adaptiveStream` with the tile element attached, so LiveKit
 *    can pick the layer that matches the tile's rendered size. The SDK cannot
 *    observe a `srcObject` set without `attach`, so the tile must call
 *    {@link SfuCall.attachVideo}.
 */

type LiveKitModule = Awaited<ReturnType<typeof loadLiveKit>>;
type LiveKitPublication = LocalTrackPublication;
type LiveKitRemoteTrack = RemoteTrack;
type LiveKitRemoteVideoTrack = RemoteVideoTrack;

/**
 * Loads the LiveKit SDK on demand. A static import would put the whole client
 * into the bundle of every visitor, including workspaces that never configure a
 * streaming server; a literal dynamic specifier keeps it in one lazy chunk.
 */
async function loadLiveKit() {
  return await import("livekit-client");
}

/** Fail fast instead of leaving the call in a half-connected state. */
export const SFU_CONNECT_TIMEOUT_MS = 4_000;

/** Voice-optimized mono Opus bitrate. */
const MIC_BITRATE = 32_000;

/** Re-mint the token this long before it expires. */
const REFRESH_MARGIN_MS = 5 * 60_000;
/** Retry delay when a re-mint fails. */
const REFRESH_RETRY_MS = 60_000;
/** Never schedule a refresh sooner than this (a clock disagreement). */
const MIN_REFRESH_MS = 60_000;
/** Fallback token lifetime when the grant carries no expiry. */
const DEFAULT_TOKEN_LIFETIME_MS = 60 * 60_000;

export interface SfuCallHandlers {
  /** Per-participant media, keyed by user id, for the tiles and audio elements. */
  readonly onStreams: (streams: ReadonlyMap<string, MediaStream>) => void;
  /** One remote user's audio level, for the speaking ring. */
  readonly onLevel: (userId: string, level: number) => void;
  /** The connection is gone and must be abandoned for the peer mesh. */
  readonly onLost: () => void;
}

export interface SfuCallMedia {
  readonly mic: MediaStreamTrack | null;
  readonly camera: MediaStreamTrack | null;
}

export interface SfuCallOptions {
  readonly timeoutMs?: number;
  /** Re-mints the call grant before the token expires. */
  readonly refreshAccess?: () => Promise<SfuAccess | null>;
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  // The shared TS lib target predates `Promise.withResolvers`, so the executor
  // form is the portable way to keep a reject handle for the timer.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("SFU connect timed out")), timeoutMs);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

export class SfuCall {
  private livekit: LiveKitModule | null = null;
  private room: Room | null = null;
  private handlers: SfuCallHandlers | null = null;
  private readonly streams = new Map<string, MediaStream>();
  private readonly videoTracks = new Map<string, LiveKitRemoteVideoTrack>();
  private readonly levels = new Map<string, () => void>();
  private micTrack: MediaStreamTrack | null = null;
  private cameraTrack: MediaStreamTrack | null = null;
  private micPublication: LiveKitPublication | null = null;
  private cameraPublication: LiveKitPublication | null = null;
  private generation = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshAccess: (() => Promise<SfuAccess | null>) | null = null;
  private timeoutMs = SFU_CONNECT_TIMEOUT_MS;

  /** Whether the room is connected and carrying the call. */
  get active(): boolean {
    return this.room !== null;
  }

  /** The per-participant microphone and camera streams. */
  get mediaStreams(): ReadonlyMap<string, MediaStream> {
    return this.streams;
  }

  /**
   * Joins the media room and publishes what is available. Returns `false` on
   * any failure (unreachable server, rejected token, failed microphone
   * publish) so the caller keeps the call on the peer mesh.
   */
  async connect(
    access: SfuAccess,
    media: SfuCallMedia,
    handlers: SfuCallHandlers,
    options: SfuCallOptions = {},
  ): Promise<boolean> {
    if (this.room !== null) {
      return true;
    }
    this.handlers = handlers;
    this.micTrack = media.mic;
    this.cameraTrack = media.camera;
    this.refreshAccess = options.refreshAccess ?? null;
    this.timeoutMs = options.timeoutMs ?? SFU_CONNECT_TIMEOUT_MS;
    const opened = await this.open(access);
    if (!opened) {
      return false;
    }
    this.scheduleRefresh(access);
    return true;
  }

  /** Swaps the published microphone, e.g. after a device change. */
  async setMic(track: MediaStreamTrack | null): Promise<void> {
    this.micTrack = track;
    if (this.room === null) {
      return;
    }
    const published = await this.publishMic();
    if (!published) {
      // Without audio the transport is worse than the mesh: give the call back.
      this.handlers?.onLost();
    }
  }

  /** Publishes or drops the camera without touching the audio path. */
  async setCamera(track: MediaStreamTrack | null): Promise<void> {
    this.cameraTrack = track;
    if (this.room !== null) {
      await this.publishCamera();
    }
  }

  /**
   * Binds a tile's video element to the subscriber so `adaptiveStream` can size
   * the requested layer. Returns `false` when this user's video is not coming
   * from the SFU (the tile then uses the mesh stream).
   */
  attachVideo(userId: string, element: HTMLVideoElement | null): boolean {
    const track = this.videoTracks.get(userId);
    if (track === undefined) {
      return false;
    }
    if (element === null) {
      track.detach();
      return false;
    }
    track.attach(element);
    return true;
  }

  /** Leaves the room and drops every stream. Idempotent. */
  async disconnect(): Promise<void> {
    this.handlers = null;
    this.micTrack = null;
    this.cameraTrack = null;
    this.refreshAccess = null;
    await this.closeRoom();
  }

  // ---- Connection ----------------------------------------------------------

  private async open(access: SfuAccess): Promise<boolean> {
    let livekit: LiveKitModule;
    try {
      livekit = await loadLiveKit();
    } catch {
      return false;
    }
    const generation = this.generation;
    const room = new livekit.Room({
      // Size-based layer selection needs the tile element (see attachVideo).
      adaptiveStream: true,
      // Stop encoding layers nobody watches.
      dynacast: true,
      // The call engine owns the capture tracks' lifetime.
      stopLocalTrackOnUnpublish: false,
    });
    this.listen(livekit, room, generation);
    try {
      await withTimeout(
        room.connect(access.url, access.token, { autoSubscribe: true, maxRetries: 0 }),
        this.timeoutMs,
      );
      if (generation !== this.generation) {
        await room.disconnect().catch(() => undefined);
        return false;
      }
      this.livekit = livekit;
      this.room = room;
      const wantsMic = this.micTrack !== null;
      const micPublished = await this.publishMic();
      if (wantsMic && !micPublished) {
        await this.closeRoom();
        return false;
      }
      await this.publishCamera();
      return true;
    } catch {
      await room.disconnect().catch(() => undefined);
      if (generation === this.generation) {
        this.livekit = null;
        this.room = null;
      }
      return false;
    }
  }

  private listen(livekit: LiveKitModule, room: Room, generation: number): void {
    const { RoomEvent, Track } = livekit;
    room.on(RoomEvent.TrackPublished, (publication) => {
      if (
        publication.source !== Track.Source.Microphone &&
        publication.source !== Track.Source.Camera
      ) {
        // This room carries the call's audio and camera only.
        publication.setSubscribed(false);
      }
    });
    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (generation !== this.generation) {
        return;
      }
      if (
        publication.source !== Track.Source.Microphone &&
        publication.source !== Track.Source.Camera
      ) {
        return;
      }
      this.addTrack(participant.identity, track);
    });
    room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
      if (generation !== this.generation) {
        return;
      }
      this.removeTrack(participant.identity, track);
    });
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (generation !== this.generation) {
        return;
      }
      this.dropUser(participant.identity);
    });
    room.on(RoomEvent.Disconnected, () => {
      this.handleLost(generation);
    });
  }

  private handleLost(generation: number): void {
    if (generation !== this.generation || this.room === null) {
      return;
    }
    this.handlers?.onLost();
    void this.closeRoom();
  }

  private async closeRoom(): Promise<void> {
    this.generation += 1;
    this.clearRefresh();
    const room = this.room;
    this.room = null;
    this.livekit = null;
    this.micPublication = null;
    this.cameraPublication = null;
    this.stopLevels();
    this.videoTracks.clear();
    this.streams.clear();
    this.emitStreams();
    if (room !== null) {
      await room.disconnect().catch(() => undefined);
    }
  }

  // ---- Publishing ----------------------------------------------------------

  private async publishMic(): Promise<boolean> {
    const room = this.room;
    const livekit = this.livekit;
    if (room === null || livekit === null) {
      return false;
    }
    const track = this.micTrack;
    if (track === null) {
      await this.unpublishMic();
      return true;
    }
    if (this.micPublication?.track?.mediaStreamTrack === track) {
      return true;
    }
    await this.unpublishMic();
    try {
      this.micPublication = await room.localParticipant.publishTrack(track, {
        source: livekit.Track.Source.Microphone,
        name: "microphone",
        stream: "call",
        dtx: true,
        red: true,
        audioPreset: { maxBitrate: MIC_BITRATE, priority: "high" },
      });
      return true;
    } catch {
      return false;
    }
  }

  private async unpublishMic(): Promise<void> {
    const publication = this.micPublication;
    this.micPublication = null;
    const track = publication?.track;
    if (track !== undefined) {
      await this.room?.localParticipant.unpublishTrack(track, false).catch(() => undefined);
    }
  }

  private async publishCamera(): Promise<void> {
    const room = this.room;
    const livekit = this.livekit;
    if (room === null || livekit === null) {
      return;
    }
    const track = this.cameraTrack;
    if (track === null) {
      await this.unpublishCamera();
      return;
    }
    if (this.cameraPublication?.track?.mediaStreamTrack === track) {
      return;
    }
    await this.unpublishCamera();
    // Three layers: a 1080p30 primary plus a 540p15 and a 270p15 simulcast
    // layer. `dynacast` stops the publisher sending a layer nobody requests.
    const top = new livekit.VideoPreset(1_920, 1_080, 2_500_000, 30);
    const mid = new livekit.VideoPreset(960, 540, 700_000, 15);
    const low = new livekit.VideoPreset(480, 270, 200_000, 15);
    try {
      this.cameraPublication = await room.localParticipant.publishTrack(track, {
        source: livekit.Track.Source.Camera,
        name: "camera",
        stream: "call",
        simulcast: true,
        videoEncoding: top.encoding,
        videoSimulcastLayers: [low, mid],
        degradationPreference: "maintain-framerate",
        backupCodec: true,
      });
    } catch {
      // The microphone path is still usable; the tile falls back to an avatar.
    }
  }

  private async unpublishCamera(): Promise<void> {
    const publication = this.cameraPublication;
    this.cameraPublication = null;
    const track = publication?.track;
    if (track !== undefined) {
      await this.room?.localParticipant.unpublishTrack(track, false).catch(() => undefined);
    }
  }

  // ---- Subscribing ---------------------------------------------------------

  private addTrack(userId: string, track: LiveKitRemoteTrack): void {
    const stream = this.streams.get(userId) ?? new MediaStream();
    if (!stream.getTracks().includes(track.mediaStreamTrack)) {
      stream.addTrack(track.mediaStreamTrack);
    }
    this.streams.set(userId, stream);
    if (track.kind === "video") {
      this.videoTracks.set(userId, track as LiveKitRemoteVideoTrack);
    } else {
      this.startLevel(userId, stream);
    }
    this.emitStreams();
  }

  private removeTrack(userId: string, track: LiveKitRemoteTrack): void {
    const stream = this.streams.get(userId);
    if (stream === undefined) {
      return;
    }
    stream.removeTrack(track.mediaStreamTrack);
    if (track.kind === "video") {
      this.videoTracks.delete(userId);
    } else {
      this.stopLevel(userId);
    }
    if (stream.getTracks().length === 0) {
      this.streams.delete(userId);
    }
    this.emitStreams();
  }

  private dropUser(userId: string): void {
    this.stopLevel(userId);
    this.videoTracks.delete(userId);
    if (this.streams.delete(userId)) {
      this.emitStreams();
    }
  }

  private emitStreams(): void {
    this.handlers?.onStreams(new Map(this.streams));
  }

  private startLevel(userId: string, stream: MediaStream): void {
    this.stopLevel(userId);
    this.levels.set(
      userId,
      createLevelMeter(stream, (level) => {
        this.handlers?.onLevel(userId, level);
      }),
    );
  }

  private stopLevel(userId: string): void {
    this.levels.get(userId)?.();
    this.levels.delete(userId);
  }

  private stopLevels(): void {
    for (const unsubscribe of this.levels.values()) {
      unsubscribe();
    }
    this.levels.clear();
  }

  // ---- Token refresh -------------------------------------------------------

  private scheduleRefresh(access: SfuAccess): void {
    this.clearRefresh();
    if (this.refreshAccess === null) {
      return;
    }
    const expiresAtMs =
      access.expiresAt !== undefined
        ? access.expiresAt * 1000
        : Date.now() + DEFAULT_TOKEN_LIFETIME_MS;
    const delay = Math.max(MIN_REFRESH_MS, expiresAtMs - Date.now() - REFRESH_MARGIN_MS);
    const generation = this.generation;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      if (generation === this.generation) {
        void this.refreshToken();
      }
    }, delay);
  }

  private clearRefresh(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * LiveKit checks the token when a client joins, not while it is connected, so
   * a connected call survives expiry. This re-mints the grant and reconnects
   * once, so a network blip hours into a call can still rejoin. A failed
   * re-mint leaves the live connection alone and retries later.
   */
  private async refreshToken(): Promise<void> {
    const fetchAccess = this.refreshAccess;
    if (fetchAccess === null || this.room === null) {
      return;
    }
    let access: SfuAccess | null = null;
    try {
      access = await fetchAccess();
    } catch {
      access = null;
    }
    if (access === null) {
      this.scheduleRetry();
      return;
    }
    await this.closeRoom();
    if (this.handlers === null) {
      return;
    }
    const opened = await this.open(access);
    if (!opened) {
      this.handlers?.onLost();
      return;
    }
    this.scheduleRefresh(access);
  }

  private scheduleRetry(): void {
    this.clearRefresh();
    const generation = this.generation;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      if (generation === this.generation) {
        void this.refreshToken();
      }
    }, REFRESH_RETRY_MS);
  }
}
