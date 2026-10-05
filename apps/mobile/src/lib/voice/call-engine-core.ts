import {
  type CallKind,
  type CallSeatResult,
  type CallSignalRow,
  type CallView,
  isCallElsewhereError,
  type PeerConnectionState,
  type VoiceDeviceSettings,
  type VoicePort,
  type VoiceSubscriptions,
} from "@aulora/core";
import { messageOf } from "./call-engine-helpers";
import type {
  VoiceIceCandidateInit,
  VoicePeerConnection,
  VoiceStream,
  VoiceTrack,
  VoiceTransceiver,
} from "./webrtc";

/**
 * The mobile WebRTC mesh call engine.
 *
 * One `RTCPeerConnection` per remote participant, media flowing peer-to-peer;
 * Convex carries only the SDP/ICE envelopes and the roster. The architecture
 * mirrors the web engine exactly:
 *  - a persistent audio *and* video transceiver per peer, so camera and screen
 *    toggles swap tracks with no renegotiation round-trip;
 *  - Opus tuned for voice, video tuned for motion vs. screen clarity;
 *  - a deterministic offerer (`shouldOffer`) so both peers agree silently.
 *
 * Plain TypeScript (no React) reporting every change through a single
 * `onChange` listener; the provider mirrors that into React state.
 */

export interface MobileVoiceLocalState {
  readonly muted: boolean;
  readonly deafened: boolean;
  readonly video: boolean;
  readonly sharingScreen: boolean;
}

export interface MobileVoiceSnapshot {
  readonly callId: string | null;
  readonly call: CallView | null;
  readonly local: MobileVoiceLocalState;
  readonly micStream: VoiceStream | null;
  /** The track to show in the local tile: screen while sharing, else camera. */
  readonly localVideoTrack: VoiceTrack | null;
  readonly remoteStreams: ReadonlyMap<string, VoiceStream>;
  /** Per-remote-participant audio level, 0..1, derived from RTP stats. */
  readonly remoteLevels: ReadonlyMap<string, number>;
  readonly micLevel: number;
  /** Whether this build exposes live mic levels (needed by push-to-talk). */
  readonly micLevelAvailable: boolean;
  readonly pending: boolean;
  readonly error: string | null;
}

export interface MobileVoiceEngineOptions {
  readonly port: VoicePort;
  readonly subscriptions: VoiceSubscriptions;
  readonly userId: string;
  /** This install. A seat held by any other id is not ours. */
  readonly clientId: string;
  readonly getSettings: () => VoiceDeviceSettings;
  readonly iceServers?: readonly { urls: string | readonly string[] }[];
  readonly onError?: (message: string) => void;
}

export interface Peer {
  readonly pc: VoicePeerConnection;
  readonly stream: VoiceStream;
  readonly initiator: boolean;
  readonly pendingCandidates: VoiceIceCandidateInit[];
  connection: PeerConnectionState;
  /** The offerer's own transceivers; the answerer inherits the remote's. */
  audioTx?: VoiceTransceiver;
  videoTx?: VoiceTransceiver;
  /** Seat generation this connection was opened against. */
  session: number;
}

const DEFAULT_ICE: readonly { urls: readonly string[] }[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

const HEARTBEAT_MS = 15_000;

/**
 * Shared engine state, lifecycle and call observation. Media handling is added
 * in {@link CallEngineMedia}; the peer mesh in {@link MobileVoiceEngine}.
 */
export abstract class CallEngineCore {
  protected readonly port: VoicePort;
  protected readonly subscriptions: VoiceSubscriptions;
  protected readonly userId: string;
  protected readonly clientId: string;
  protected readonly getSettings: () => VoiceDeviceSettings;
  protected readonly iceServers: readonly { urls: string | readonly string[] }[];
  protected readonly onError: (message: string) => void;
  protected readonly listeners = new Set<() => void>();

  protected callId: string | null = null;
  protected call: CallView | null = null;
  protected local: MobileVoiceLocalState = {
    muted: false,
    deafened: false,
    video: false,
    sharingScreen: false,
  };
  protected micStream: VoiceStream | null = null;
  protected cameraTrack: VoiceTrack | null = null;
  protected screenTrack: VoiceTrack | null = null;
  protected micLevel = 0;
  protected micLevelAvailable = false;
  protected levelUnsub: (() => void) | null = null;
  protected pending = false;
  protected error: string | null = null;

  protected readonly peers = new Map<string, Peer>();
  protected readonly remoteStreams = new Map<string, VoiceStream>();
  protected readonly remoteLevels = new Map<string, number>();
  protected readonly processedSignals = new Set<string>();
  protected callUnsub: (() => void) | null = null;
  protected signalUnsub: (() => void) | null = null;
  protected heartbeat: ReturnType<typeof setInterval> | null = null;
  protected levelHunt: ReturnType<typeof setInterval> | null = null;

  constructor(options: MobileVoiceEngineOptions) {
    this.port = options.port;
    this.subscriptions = options.subscriptions;
    this.userId = options.userId;
    this.clientId = options.clientId;
    this.getSettings = options.getSettings;
    this.iceServers =
      options.iceServers !== undefined && options.iceServers.length > 0
        ? options.iceServers
        : DEFAULT_ICE;
    this.onError = options.onError ?? (() => {});
  }

  // ---- Observation ---------------------------------------------------------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  getSnapshot(): MobileVoiceSnapshot {
    return {
      callId: this.callId,
      call: this.call,
      local: this.local,
      micStream: this.micStream,
      localVideoTrack: this.screenTrack ?? this.cameraTrack,
      remoteStreams: this.remoteStreams,
      remoteLevels: this.remoteLevels,
      micLevel: this.micLevel,
      micLevelAvailable: this.micLevelAvailable,
      pending: this.pending,
      error: this.error,
    };
  }

  isActive(): boolean {
    return this.callId !== null;
  }

  // ---- Call lifecycle ------------------------------------------------------

  async startCall(args: {
    readonly channelId: string;
    readonly kind: CallKind;
    readonly ringingUserIds?: readonly string[];
    readonly takeover?: boolean;
  }): Promise<Exclude<CallSeatResult, { status: "cancelled" }>> {
    this.setError(null);
    this.pending = true;
    this.emit();
    try {
      const result = await this.port.startCall(args);
      await this.enter(result.callId);
      return { status: "joined", callId: result.callId };
    } catch (error) {
      if (isCallElsewhereError(error)) {
        return { status: "elsewhere", callId: error.callId, channelId: error.channelId };
      }
      this.setError(messageOf(error));
      return { status: "failed" };
    } finally {
      this.pending = false;
      this.emit();
    }
  }

  async joinCall(
    callId: string,
    options?: { readonly takeover?: boolean },
  ): Promise<Exclude<CallSeatResult, { status: "cancelled" }>> {
    this.setError(null);
    this.pending = true;
    this.emit();
    try {
      await this.port.joinCall({
        callId,
        ...(options?.takeover === true ? { takeover: true } : {}),
      });
      await this.enter(callId);
      return { status: "joined", callId };
    } catch (error) {
      if (isCallElsewhereError(error)) {
        return { status: "elsewhere", callId: error.callId, channelId: error.channelId };
      }
      this.setError(messageOf(error));
      return { status: "failed" };
    } finally {
      this.pending = false;
      this.emit();
    }
  }

  async declineCall(callId: string): Promise<void> {
    try {
      await this.port.declineCall({ callId });
    } catch (error) {
      this.setError(messageOf(error));
    }
  }

  async leave(): Promise<void> {
    const callId = this.callId;
    this.enterTeardown();
    if (callId !== null) {
      try {
        await this.port.leaveCall({ callId });
      } catch {
        // Leaving is best-effort; the server sweep cleans a dropped client.
      }
    }
  }

  async endCall(): Promise<void> {
    const callId = this.callId;
    this.enterTeardown();
    if (callId !== null) {
      try {
        await this.port.endCall({ callId });
      } catch (error) {
        this.setError(messageOf(error));
      }
    }
  }

  protected async enter(callId: string): Promise<void> {
    if (this.callId === callId) {
      return;
    }
    this.enterTeardown();
    this.callId = callId;
    this.processedSignals.clear();
    const watched = callId;
    this.callUnsub = this.subscriptions.watchCallById(callId, (call) => {
      if (this.callId !== watched) {
        return;
      }
      void this.onCallUpdate(call);
    });
    this.signalUnsub = this.subscriptions.watchSignals(callId, (signals) => {
      void this.onSignals(signals);
    });
    this.heartbeat = setInterval(() => {
      if (this.callId !== null) {
        void this.port.callHeartbeat({ callId: this.callId }).catch(() => undefined);
      }
    }, HEARTBEAT_MS);
    this.startRemoteLevelHunt();
    await this.acquireMic();
    const settings = this.getSettings();
    this.local = { ...this.local, muted: settings.joinMuted };
    if (this.micStream !== null) {
      for (const track of this.micStream.getAudioTracks()) {
        track.enabled = !settings.joinMuted;
      }
    }
    void this.port.updateParticipant({ callId, muted: settings.joinMuted }).catch(() => undefined);
    this.emit();
  }

  protected enterTeardown(): void {
    this.callUnsub?.();
    this.signalUnsub?.();
    this.callUnsub = null;
    this.signalUnsub = null;
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.levelHunt !== null) {
      clearInterval(this.levelHunt);
      this.levelHunt = null;
    }
    this.remoteLevels.clear();
    this.closeAllPeers();
    this.stopLevelMeter();
    this.micStream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.micStream = null;
    this.cameraTrack?.stop();
    this.cameraTrack = null;
    this.screenTrack?.stop();
    this.screenTrack = null;
    this.remoteStreams.clear();
    this.callId = null;
    this.call = null;
    this.local = { muted: false, deafened: false, video: false, sharingScreen: false };
    this.processedSignals.clear();
    this.emit();
  }

  // ---- Errors --------------------------------------------------------------

  setError(message: string | null): void {
    this.error = message;
    if (message !== null) {
      this.onError(message);
    }
    this.emit();
  }

  clearError(): void {
    this.error = null;
    this.emit();
  }

  dispose(): void {
    this.enterTeardown();
    this.listeners.clear();
  }

  // ---- Hooks implemented by the media/peer layers --------------------------

  protected abstract onCallUpdate(call: CallView | null): Promise<void>;
  protected abstract onSignals(signals: readonly CallSignalRow[]): Promise<void>;
  protected abstract closeAllPeers(): void;
  protected abstract acquireMic(): Promise<void>;
  protected abstract startRemoteLevelHunt(): void;
  protected abstract stopLevelMeter(): void;
}
