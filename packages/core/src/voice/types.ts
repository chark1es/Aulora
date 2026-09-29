/**
 * Voice and video call domain types, shared by web, desktop and mobile.
 *
 * Like the rest of `@aulora/core` this module is framework-agnostic and
 * dependency-free. The backend (Convex) carries only call *state* and WebRTC
 * *signalling* payloads; the media itself is peer-to-peer and never touches the
 * server. Everything here is plain data so the call logic is unit-testable
 * without a browser or a device.
 */

/** A call is either audio-only or audio + video. */
export type CallKind = "voice" | "video";

/**
 * `ringing` means the call has been placed but nobody has answered yet (DM and
 * group-DM calls only). A voice channel call is `active` as soon as it exists.
 */
export type CallStatus = "ringing" | "active" | "ended";

export type CallSignalKind = "offer" | "answer" | "ice" | "renegotiate";

/** Peer connection health as reported by the local `RTCPeerConnection`. */
export type PeerConnectionState = "connecting" | "connected" | "reconnecting" | "failed";

/** How a participant's media is wired up. */
export type MediaDeviceKind = "audioinput" | "audiooutput" | "videoinput";

export interface MediaDeviceInfo {
  readonly deviceId: string;
  readonly kind: MediaDeviceKind;
  readonly label: string;
}

export interface VoiceDeviceSettings {
  /** Selected microphone; `null` means the system default. */
  readonly inputDeviceId: string | null;
  /** Selected speaker; `null` means the system default. */
  readonly outputDeviceId: string | null;
  /** Selected camera; `null` means the system default. */
  readonly cameraDeviceId: string | null;
  /** WebRTC audio constraints, wired straight into `getUserMedia`. */
  readonly echoCancellation: boolean;
  readonly noiseSuppression: boolean;
  readonly autoGainControl: boolean;
  /** Input gain applied client-side, 0..2 (1 is unity). */
  readonly inputVolume: number;
  /** Playback gain applied client-side, 0..2 (1 is unity). */
  readonly outputVolume: number;
  /** Mirrors the local self-view in video calls. */
  readonly mirrorCamera: boolean;
  readonly videoResolution: "360p" | "720p" | "1080p";
  /** Mutes the microphone unless a push-to-talk key is held. */
  readonly pushToTalk: boolean;
  /** Input level below which push-to-talk transmits nothing, 0..1. */
  readonly noiseGateThreshold: number;
  /** Preferred codec for screen share (text clarity); `auto` lets the browser choose. */
  readonly screenCodec: "auto" | "av1" | "vp9" | "h264";
  /** Joins calls with the microphone already muted. */
  readonly joinMuted: boolean;
  /** Joins video calls with the camera already on. */
  readonly joinWithCamera: boolean;
}

/** One participant of a live call, as rendered by every client. */
export interface CallParticipantView {
  readonly userId: string;
  readonly muted: boolean;
  readonly deafened: boolean;
  readonly video: boolean;
  readonly sharingScreen: boolean;
  readonly joinedAt: number;
  /** Local-only: remote audio level, 0..1. */
  readonly speaking: boolean;
  readonly audioLevel: number;
  readonly connection: PeerConnectionState;
}

export interface CallView {
  readonly id: string;
  readonly channelId: string;
  readonly kind: CallKind;
  readonly status: CallStatus;
  readonly initiatorId: string;
  /** Users still being rung (DM/group-DM calls); empty for voice channels. */
  readonly ringingUserIds: readonly string[];
  readonly screenShareUserId: string | null;
  readonly startedAt: number;
  readonly participants: readonly CallParticipantView[];
}

export interface CallSignalRow {
  readonly id: string;
  readonly callId: string;
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly kind: CallSignalKind;
  readonly payload: string;
  readonly createdAt: number;
}

/**
 * Imperative voice backend: call lifecycle, participant state and signalling.
 * The media path never crosses this boundary.
 */
export interface VoicePort {
  /** Starts a call on a channel, or returns the active one. Rungs `ringingUserIds`. */
  startCall(args: {
    readonly channelId: string;
    readonly kind: CallKind;
    readonly ringingUserIds?: readonly string[];
  }): Promise<{ callId: string; created: boolean }>;
  joinCall(args: { readonly callId: string }): Promise<null>;
  leaveCall(args: { readonly callId: string }): Promise<null>;
  endCall(args: { readonly callId: string }): Promise<null>;
  /** Declines a ringing DM call without joining. */
  declineCall(args: { readonly callId: string }): Promise<null>;
  updateParticipant(args: {
    readonly callId: string;
    readonly muted?: boolean;
    readonly deafened?: boolean;
    readonly video?: boolean;
    readonly sharingScreen?: boolean;
  }): Promise<null>;
  /** Keeps the participant row fresh so the server can sweep abandoned calls. */
  callHeartbeat(args: { readonly callId: string }): Promise<null>;
  sendSignal(args: {
    readonly callId: string;
    readonly toUserId: string;
    readonly kind: CallSignalKind;
    readonly payload: string;
  }): Promise<null>;
  /** Removes signalling rows this client has already processed. */
  ackSignals(args: { readonly signalIds: readonly string[] }): Promise<null>;
}

/** Live voice state, mirroring `VoicePort`. */
export interface VoiceSubscriptions {
  /** The active call on a channel, if any. */
  watchCall(channelId: string, onChange: (call: CallView | null) => void): () => void;
  /** The live state of one call. */
  watchCallById(callId: string, onChange: (call: CallView | null) => void): () => void;
  /** Signalling rows addressed to the caller for one call. */
  watchSignals(callId: string, onChange: (signals: readonly CallSignalRow[]) => void): () => void;
  /** Calls currently ringing the caller (DM/group-DM). */
  watchIncoming(onChange: (calls: readonly CallView[]) => void): () => void;
  /** Every live call in the workspace, for channel indicators. */
  watchActiveCalls(onChange: (calls: readonly CallView[]) => void): () => void;
}
