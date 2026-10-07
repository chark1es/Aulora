/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { CallView, VoiceDeviceSettings, VoicePort, VoiceSubscriptions } from "@aulora/core";

export interface VoiceLocalState {
  readonly muted: boolean;
  readonly deafened: boolean;
  readonly video: boolean;
  readonly sharingScreen: boolean;
}

export interface VoiceSnapshot {
  readonly callId: string | null;
  readonly call: CallView | null;
  readonly local: VoiceLocalState;
  readonly micStream: MediaStream | null;
  /** The track to show in the local tile: screen while sharing, else camera. */
  readonly localVideoTrack: MediaStreamTrack | null;
  readonly remoteStreams: ReadonlyMap<string, MediaStream>;
  /** Screens relayed by the streaming server, keyed by the sharer's user id. */
  readonly remoteScreens: ReadonlyMap<string, MediaStream>;
  /** Remote users whose audio is currently above the speaking threshold. */
  readonly remoteSpeaking: ReadonlySet<string>;
  readonly micLevel: number;
  /** Whether this device is currently transmitting speech. */
  readonly localSpeaking: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  /** Set when the microphone/camera could not be acquired for this call. */
  readonly mediaError: string | null;
}

export interface VoiceEngineOptions {
  readonly port: VoicePort;
  readonly subscriptions: VoiceSubscriptions;
  readonly userId: string;
  /** This install. A seat held by any other id is not ours. */
  readonly clientId: string;
  readonly getSettings: () => VoiceDeviceSettings;
  /** Read lazily on each peer so late-loaded deployment config still applies. */
  readonly getIceServers?: () => readonly RTCIceServer[];
  readonly onError?: (message: string) => void;
}
