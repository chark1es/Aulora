import {
  type MediaDeviceInfo as AuloraMediaDevice,
  resolutionConstraints,
  type VoiceDeviceSettings,
} from "@aulora/core";
import type { ComponentType } from "react";

/**
 * Compile-safe indirection over `react-native-webrtc`.
 *
 * The native module is deliberately *not* imported statically: it is a native
 * dependency that is absent until the app is prebuilt with it. Everything the
 * call engine touches is expressed as a minimal structural interface here, the
 * real module is loaded lazily through a top-level `require` (which Metro can
 * still resolve at bundle time) inside a `try`/`catch`, and the accessors throw
 * a clear error when it is missing. That keeps `tsc --noEmit` green in a plain
 * checkout while allowing a real device to run full WebRTC once the package is
 * installed.
 */

declare const require: (id: string) => unknown;

export interface VoiceIceServer {
  readonly urls: string | readonly string[];
  readonly username?: string;
  readonly credential?: string;
}

export interface VoicePeerConnectionConfig {
  readonly iceServers?: readonly VoiceIceServer[];
  readonly bundlePolicy?: string;
  readonly rtcpMuxPolicy?: string;
}

export interface VoiceSessionDescriptionInit {
  readonly type: string;
  readonly sdp?: string;
}

export interface VoiceIceCandidateInit {
  readonly candidate?: string;
  readonly sdpMid?: string | null;
  readonly sdpMLineIndex?: number | null;
  readonly usernameFragment?: string | null;
}

export interface VoiceIceCandidate {
  toJSON(): VoiceIceCandidateInit;
}

export interface VoiceTrack {
  readonly kind: string;
  enabled: boolean;
  readonly id?: string;
  stop(): void;
  getSettings?(): { readonly deviceId?: string };
  addEventListener?(type: string, listener: () => void): void;
  /** Native gain control where the platform exposes it. */
  _setVolume?(volume: number): void;
}

export interface VoiceStream {
  getTracks(): VoiceTrack[];
  getAudioTracks(): VoiceTrack[];
  getVideoTracks(): VoiceTrack[];
  addTrack(track: VoiceTrack): void;
  removeTrack(track: VoiceTrack): void;
  toURL?(): string;
}

export interface VoiceSenderParametersEncoding {
  maxBitrate?: number;
  maxFramerate?: number;
  networkPriority?: string;
}

export interface VoiceSenderParameters {
  encodings?: VoiceSenderParametersEncoding[];
  degradationPreference?: string;
}

export interface VoiceRtpSender {
  readonly track: VoiceTrack | null;
  replaceTrack(track: VoiceTrack | null): Promise<void>;
  getParameters(): VoiceSenderParameters;
  setParameters(parameters: VoiceSenderParameters): Promise<void>;
}

export interface VoiceRtpReceiver {
  readonly track: VoiceTrack | null;
  playoutDelayHint?: number;
  jitterBufferTarget?: number;
  /** Present on newer native builds; yields per-receiver RTP stats. */
  getStats?(): Promise<unknown>;
}

export interface VoiceTransceiver {
  /** `sendrecv` / `sendonly` / `recvonly` / `inactive`; mutable at runtime. */
  direction: string;
  readonly sender: VoiceRtpSender;
  readonly receiver: VoiceRtpReceiver;
}

export interface VoiceTrackEvent {
  readonly track: VoiceTrack;
}

export interface VoiceIceCandidateEvent {
  readonly candidate: VoiceIceCandidate | null;
}

export interface VoicePeerConnection {
  readonly signalingState: string;
  readonly connectionState: string;
  readonly iceConnectionState: string;
  readonly localDescription: VoiceSessionDescriptionInit | null;
  readonly remoteDescription: VoiceSessionDescriptionInit | null;
  onicecandidate: ((event: VoiceIceCandidateEvent) => void) | null;
  ontrack: ((event: VoiceTrackEvent) => void) | null;
  onconnectionstatechange: (() => void) | null;
  oniceconnectionstatechange: (() => void) | null;
  addTransceiver(kind: string, init?: { readonly direction?: string }): VoiceTransceiver;
  getTransceivers(): VoiceTransceiver[];
  createOffer(): Promise<VoiceSessionDescriptionInit>;
  createAnswer(): Promise<VoiceSessionDescriptionInit>;
  setLocalDescription(description: VoiceSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: VoiceSessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate: VoiceIceCandidateInit): Promise<void>;
  restartIce?(): void;
  close(): void;
}

export interface VoiceDeviceInfo {
  readonly deviceId: string;
  readonly kind: string;
  readonly label: string;
}

export interface VoiceMediaStreamConstraints {
  readonly audio?: boolean | Record<string, unknown>;
  readonly video?: boolean | Record<string, unknown>;
}

export interface VoiceMediaDevices {
  getUserMedia(constraints: VoiceMediaStreamConstraints): Promise<VoiceStream>;
  getDisplayMedia?(constraints: VoiceMediaStreamConstraints): Promise<VoiceStream>;
  enumerateDevices(): Promise<VoiceDeviceInfo[]>;
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}

export interface VoicePeerConnectionConstructor {
  new (config: VoicePeerConnectionConfig): VoicePeerConnection;
}

export interface VoiceSessionDescriptionConstructor {
  new (init: VoiceSessionDescriptionInit): VoiceSessionDescriptionInit;
}

export interface VoiceIceCandidateConstructor {
  new (init: VoiceIceCandidateInit): VoiceIceCandidateInit;
}

export interface VoiceStreamConstructor {
  new (tracks?: VoiceTrack[]): VoiceStream;
}

export interface VoiceRTCViewProps {
  readonly streamURL: string;
  readonly mirror?: boolean;
  readonly objectFit?: "contain" | "cover";
  readonly zOrder?: number;
  readonly style?: unknown;
}

interface NativeWebRTCModule {
  readonly RTCPeerConnection?: VoicePeerConnectionConstructor;
  readonly RTCSessionDescription?: VoiceSessionDescriptionConstructor;
  readonly RTCIceCandidate?: VoiceIceCandidateConstructor;
  readonly MediaStream?: VoiceStreamConstructor;
  readonly mediaDevices?: VoiceMediaDevices;
  readonly RTCView?: ComponentType<VoiceRTCViewProps>;
}

let nativeModule: NativeWebRTCModule | null = null;
try {
  nativeModule = require("react-native-webrtc") as NativeWebRTCModule;
} catch {
  nativeModule = null;
}

/** Whether the real native WebRTC module resolved on this build. */
export const webrtcAvailable: boolean =
  nativeModule !== null &&
  typeof nativeModule.RTCPeerConnection === "function" &&
  nativeModule.mediaDevices !== undefined;

function unavailable(): never {
  throw new Error(
    "Voice calling needs the react-native-webrtc native module. Install it and rebuild the app.",
  );
}

/** The peer-connection constructor, or a clear error when WebRTC is absent. */
export function peerConnectionConstructor(): VoicePeerConnectionConstructor {
  const ctor = nativeModule?.RTCPeerConnection;
  if (ctor === undefined) {
    unavailable();
  }
  return ctor;
}

/** The mediaDevices singleton, or a clear error when WebRTC is absent. */
export function mediaDevices(): VoiceMediaDevices {
  const devices = nativeModule?.mediaDevices;
  if (devices === undefined) {
    unavailable();
  }
  return devices;
}

/** The native video renderer, or `null` when WebRTC is absent. */
export function videoRenderer(): ComponentType<VoiceRTCViewProps> | null {
  return nativeModule?.RTCView ?? null;
}

/** Whether this build can capture a screen (mobile often cannot). */
export function supportsScreenShare(): boolean {
  return nativeModule?.mediaDevices?.getDisplayMedia !== undefined;
}

export function createPeerConnection(config: VoicePeerConnectionConfig): VoicePeerConnection {
  const Ctor = peerConnectionConstructor();
  return new Ctor(config);
}

export function createMediaStream(tracks: VoiceTrack[] = []): VoiceStream {
  const Ctor = nativeModule?.MediaStream;
  if (Ctor === undefined) {
    unavailable();
  }
  return new Ctor(tracks);
}

/** Like {@link createMediaStream} but returns `null` instead of throwing. */
export function tryCreateMediaStream(tracks: VoiceTrack[] = []): VoiceStream | null {
  const Ctor = nativeModule?.MediaStream;
  return Ctor === undefined ? null : new Ctor(tracks);
}

/** Wraps an SDP init in the native description type when the module provides one. */
export function createSessionDescription(
  init: VoiceSessionDescriptionInit,
): VoiceSessionDescriptionInit {
  const Ctor = nativeModule?.RTCSessionDescription;
  return Ctor === undefined ? init : new Ctor(init);
}

/** Wraps an ICE init in the native candidate type when the module provides one. */
export function createIceCandidate(init: VoiceIceCandidateInit): VoiceIceCandidateInit {
  const Ctor = nativeModule?.RTCIceCandidate;
  return Ctor === undefined ? init : new Ctor(init);
}

// ---- Media capture ---------------------------------------------------------

function audioConstraints(settings: VoiceDeviceSettings): Record<string, unknown> {
  return {
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    ...(settings.inputDeviceId !== null ? { deviceId: { exact: settings.inputDeviceId } } : {}),
  };
}

function videoConstraints(settings: VoiceDeviceSettings): Record<string, unknown> {
  const target = resolutionConstraints(settings.videoResolution);
  return {
    ...target,
    ...(settings.cameraDeviceId !== null ? { deviceId: { exact: settings.cameraDeviceId } } : {}),
  };
}

/** Requests the microphone, and the camera when `withVideo`, with the stored settings. */
export async function acquireUserMedia(options: {
  readonly settings: VoiceDeviceSettings;
  readonly withVideo: boolean;
}): Promise<VoiceStream> {
  return mediaDevices().getUserMedia({
    audio: audioConstraints(options.settings),
    video: options.withVideo ? videoConstraints(options.settings) : false,
  });
}

/** Requests a camera track with the stored settings. */
export async function acquireVideo(settings: VoiceDeviceSettings): Promise<VoiceTrack> {
  const stream = await mediaDevices().getUserMedia({ video: videoConstraints(settings) });
  const track = stream.getVideoTracks()[0];
  if (track === undefined) {
    throw new Error("No camera track was produced");
  }
  return track;
}

/** Requests a screen capture where the platform supports it. */
export async function acquireDisplay(settings: VoiceDeviceSettings): Promise<VoiceTrack> {
  const devices = mediaDevices();
  if (devices.getDisplayMedia === undefined) {
    throw new Error("Screen sharing is not supported on this device");
  }
  const stream = await devices.getDisplayMedia({
    video: { frameRate: { ideal: 30, max: 60 } },
    audio: true,
  });
  const track = stream.getVideoTracks()[0];
  if (track === undefined) {
    throw new Error("No screen track was produced");
  }
  applyContentHint(track, settings.screenCodec);
  return track;
}

function applyContentHint(track: VoiceTrack, codec: VoiceDeviceSettings["screenCodec"]): void {
  const hint = codec === "auto" ? "detail" : "text";
  const target = track as VoiceTrack & { contentHint?: string };
  try {
    target.contentHint = hint;
  } catch {
    // Some native builds reject unknown hints; the track still works.
  }
}

/** Enumerates capture devices, filling in labels the platform omits. */
export async function listMediaDevices(): Promise<AuloraMediaDevice[]> {
  let devices: VoiceDeviceInfo[];
  try {
    devices = await mediaDevices().enumerateDevices();
  } catch {
    return [];
  }
  const kindOf = (kind: string): AuloraMediaDevice["kind"] | null => {
    if (kind === "audioinput" || kind === "audiooutput" || kind === "videoinput") {
      return kind;
    }
    return null;
  };
  const result: AuloraMediaDevice[] = [];
  for (const device of devices) {
    const kind = kindOf(device.kind);
    if (kind === null) {
      continue;
    }
    result.push({
      deviceId: device.deviceId,
      kind,
      label:
        device.label.length > 0
          ? device.label
          : defaultLabel(kind, result.filter((entry) => entry.kind === kind).length + 1),
    });
  }
  return result;
}

function defaultLabel(kind: AuloraMediaDevice["kind"], index: number): string {
  switch (kind) {
    case "audioinput":
      return `Microphone ${index}`;
    case "audiooutput":
      return `Speaker ${index}`;
    case "videoinput":
      return `Camera ${index}`;
  }
}

/** Subscribes to device add/remove where supported. Returns an unsubscribe. */
export function onDeviceChange(listener: () => void): () => void {
  const devices = nativeModule?.mediaDevices;
  if (devices?.addEventListener === undefined) {
    return () => {};
  }
  devices.addEventListener("devicechange", listener);
  return () => devices.removeEventListener?.("devicechange", listener);
}

export interface LevelMeter {
  /** Stops polling. Safe to call more than once. */
  stop(): void;
  /** Whether this build exposes per-track stats at all. */
  readonly available: boolean;
}

/**
 * Live microphone level. Native WebRTC ships no WebAudio graph, so this polls
 * any per-track stats the build exposes (some expose `getStats`) and reports a
 * 0..1 level. `react-native-webrtc` tracks do not implement `getStats`, so
 * `available` is `false` there and callers must not treat the mic as gated:
 * the UI marks push-to-talk as unavailable rather than silently transmitting.
 */
export function createLevelMeter(
  stream: VoiceStream,
  onLevel: (level: number) => void,
  intervalMs = 400,
): LevelMeter {
  const track = stream.getAudioTracks()[0] as
    | (VoiceTrack & { getStats?: () => Promise<unknown> })
    | undefined;
  if (track === undefined || typeof (track as { getStats?: unknown }).getStats !== "function") {
    return { stop: () => {}, available: false };
  }
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) {
      return;
    }
    void Promise.resolve(track.getStats?.())
      .then((stats) => {
        if (stopped) {
          return;
        }
        const level = extractAudioLevel(stats);
        if (level !== null) {
          onLevel(level);
        }
      })
      .catch(() => undefined);
  }, intervalMs);
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    available: true,
  };
}

/**
 * Best-effort audio level from an RTP stats blob. Accepts either a `Map` or a
 * plain object of stat records and picks the highest `audioLevel` it finds.
 */
export function extractAudioLevel(stats: unknown): number | null {
  if (stats === null || stats === undefined) {
    return null;
  }
  const records: unknown[] = [];
  if (stats instanceof Map) {
    for (const value of stats.values()) {
      records.push(value);
    }
  } else if (typeof stats === "object") {
    for (const value of Object.values(stats as Record<string, unknown>)) {
      records.push(value);
    }
  }
  let best: number | null = null;
  for (const record of records) {
    if (record === null || typeof record !== "object") {
      continue;
    }
    const value = (record as { audioLevel?: unknown }).audioLevel;
    if (typeof value === "number" && Number.isFinite(value)) {
      const clamped = Math.min(1, Math.max(0, value));
      best = best === null ? clamped : Math.max(best, clamped);
    }
  }
  return best;
}

/** Applies a native gain to a track where supported; otherwise a no-op. */
export function setTrackVolume(track: VoiceTrack, volume: number): void {
  try {
    track._setVolume?.(volume);
  } catch {
    // The platform does not expose per-track gain.
  }
}
