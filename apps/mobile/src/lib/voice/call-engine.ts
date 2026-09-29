import {
  type CallKind,
  type CallSignalRow,
  type CallView,
  type PeerConnectionState,
  shouldOffer,
  type VoiceDeviceSettings,
  type VoicePort,
  type VoiceSubscriptions,
} from "@aulora/core";
import {
  acquireDisplay,
  acquireUserMedia,
  acquireVideo,
  createIceCandidate,
  createLevelMeter,
  createMediaStream,
  createPeerConnection,
  createSessionDescription,
  extractAudioLevel,
  setTrackVolume,
  type VoiceIceCandidateInit,
  type VoicePeerConnection,
  type VoiceSessionDescriptionInit,
  type VoiceStream,
  type VoiceTrack,
  type VoiceTransceiver,
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
  readonly getSettings: () => VoiceDeviceSettings;
  readonly iceServers?: readonly { urls: string | readonly string[] }[];
  readonly onError?: (message: string) => void;
}

interface Peer {
  readonly pc: VoicePeerConnection;
  readonly stream: VoiceStream;
  readonly initiator: boolean;
  readonly pendingCandidates: VoiceIceCandidateInit[];
  connection: PeerConnectionState;
  /** The offerer's own transceivers; the answerer inherits the remote's. */
  audioTx?: VoiceTransceiver;
  videoTx?: VoiceTransceiver;
}

const DEFAULT_ICE: readonly { urls: readonly string[] }[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

const HEARTBEAT_MS = 15_000;

function parsePayload<T>(payload: string): T | null {
  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

export class MobileVoiceEngine {
  private readonly port: VoicePort;
  private readonly subscriptions: VoiceSubscriptions;
  private readonly userId: string;
  private readonly getSettings: () => VoiceDeviceSettings;
  private readonly iceServers: readonly { urls: string | readonly string[] }[];
  private readonly onError: (message: string) => void;
  private readonly listeners = new Set<() => void>();

  private callId: string | null = null;
  private call: CallView | null = null;
  private local: MobileVoiceLocalState = {
    muted: false,
    deafened: false,
    video: false,
    sharingScreen: false,
  };
  private micStream: VoiceStream | null = null;
  private cameraTrack: VoiceTrack | null = null;
  private screenTrack: VoiceTrack | null = null;
  private micLevel = 0;
  private micLevelAvailable = false;
  private levelUnsub: (() => void) | null = null;
  private pending = false;
  private error: string | null = null;

  private readonly peers = new Map<string, Peer>();
  private readonly remoteStreams = new Map<string, VoiceStream>();
  private readonly remoteLevels = new Map<string, number>();
  private readonly processedSignals = new Set<string>();
  private callUnsub: (() => void) | null = null;
  private signalUnsub: (() => void) | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private levelHunt: ReturnType<typeof setInterval> | null = null;

  constructor(options: MobileVoiceEngineOptions) {
    this.port = options.port;
    this.subscriptions = options.subscriptions;
    this.userId = options.userId;
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

  private emit(): void {
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
  }): Promise<string | null> {
    this.setError(null);
    this.pending = true;
    this.emit();
    try {
      const result = await this.port.startCall(args);
      await this.enter(result.callId);
      return result.callId;
    } catch (error) {
      this.setError(messageOf(error));
      return null;
    } finally {
      this.pending = false;
      this.emit();
    }
  }

  async joinCall(callId: string): Promise<boolean> {
    this.setError(null);
    this.pending = true;
    this.emit();
    try {
      await this.port.joinCall({ callId });
      await this.enter(callId);
      return true;
    } catch (error) {
      this.setError(messageOf(error));
      return false;
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

  private async enter(callId: string): Promise<void> {
    if (this.callId === callId) {
      return;
    }
    this.enterTeardown();
    this.callId = callId;
    this.processedSignals.clear();
    this.callUnsub = this.subscriptions.watchCallById(callId, (call) => {
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

  private enterTeardown(): void {
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

  private async acquireMic(): Promise<void> {
    try {
      this.micStream = await acquireUserMedia({
        settings: this.getSettings(),
        withVideo: false,
      });
    } catch (error) {
      this.onError(messageOf(error));
      this.micStream = null;
      return;
    }
    this.startLevelMeter();
    // A peer may have been created (and offered) before the mic resolved; give
    // it the real track now that we have it. `replaceTrack` needs no renegotiation.
    await this.applyAudioTrack(this.micStream.getAudioTracks()[0] ?? null);
  }

  private startLevelMeter(): void {
    this.stopLevelMeter();
    if (this.micStream === null) {
      return;
    }
    this.applyInputVolume();
    const meter = createLevelMeter(this.micStream, (level) => {
      this.micLevel = level;
      this.applyNoiseGate(level);
      this.emit();
    });
    this.micLevelAvailable = meter.available;
    this.levelUnsub = meter.stop;
    this.enforceGateSafety();
  }

  private stopLevelMeter(): void {
    this.levelUnsub?.();
    this.levelUnsub = null;
    this.micLevelAvailable = false;
    this.micLevel = 0;
  }

  /**
   * Push-to-talk needs live level data to know when the key is effectively
   * held. `react-native-webrtc` exposes none, so when the meter is unavailable
   * the mic is kept closed rather than left hot; the settings UI surfaces the
   * feature as unsupported instead of pretending it works.
   */
  private enforceGateSafety(): void {
    if (this.micStream === null || this.micLevelAvailable) {
      return;
    }
    if (!this.getSettings().pushToTalk) {
      return;
    }
    for (const track of this.micStream.getAudioTracks()) {
      track.enabled = false;
    }
  }

  /** Applies the configured microphone gain to every local audio track. */
  private applyInputVolume(): void {
    if (this.micStream === null) {
      return;
    }
    const volume = this.getSettings().inputVolume;
    for (const track of this.micStream.getAudioTracks()) {
      setTrackVolume(track, volume);
    }
  }

  /**
   * Push-to-talk / noise gate. When either is on, the mic only transmits while
   * the level clears the threshold; otherwise it follows the mute flag. Native
   * level data is best-effort, so an unknown level keeps the mic audible.
   */
  private applyNoiseGate(level: number): void {
    const settings = this.getSettings();
    if (
      this.micStream === null ||
      !this.micLevelAvailable ||
      (!settings.pushToTalk && settings.noiseGateThreshold <= 0)
    ) {
      return;
    }
    if (this.local.muted) {
      return;
    }
    const open = settings.pushToTalk ? level > settings.noiseGateThreshold : true;
    for (const track of this.micStream.getAudioTracks()) {
      track.enabled = open;
    }
  }

  /**
   * Polls remote audio receivers for their RTP `audioLevel` and publishes a
   * per-participant map. Native engines without `getStats` simply produce an
   * empty map and the UI falls back to mute flags.
   */
  private startRemoteLevelHunt(): void {
    if (this.levelHunt !== null) {
      clearInterval(this.levelHunt);
    }
    this.levelHunt = setInterval(() => {
      void this.pollRemoteLevels();
    }, 500);
  }

  private async pollRemoteLevels(): Promise<void> {
    if (this.peers.size === 0) {
      return;
    }
    let changed = false;
    await Promise.all(
      [...this.peers.entries()].map(async ([remoteId, peer]) => {
        const receiver = this.transceiversFor(peer, "audio")[0]?.receiver;
        if (receiver === undefined || typeof receiver.getStats !== "function") {
          return;
        }
        try {
          const stats = await receiver.getStats();
          const level = extractAudioLevel(stats);
          if (level === null) {
            return;
          }
          const previous = this.remoteLevels.get(remoteId) ?? -1;
          if (Math.abs(previous - level) > 0.02) {
            this.remoteLevels.set(remoteId, level);
            changed = true;
          }
        } catch {
          // Receiver stats are best-effort.
        }
      }),
    );
    if (changed) {
      this.emit();
    }
  }

  // ---- Media controls ------------------------------------------------------

  async setMuted(muted: boolean): Promise<void> {
    this.local = { ...this.local, muted };
    if (this.micStream !== null) {
      for (const track of this.micStream.getAudioTracks()) {
        track.enabled = !muted;
      }
    }
    if (this.callId !== null) {
      void this.port.updateParticipant({ callId: this.callId, muted }).catch(() => undefined);
    }
    this.emit();
  }

  setDeafened(deafened: boolean): void {
    this.local = { ...this.local, deafened };
    if (deafened && !this.local.muted) {
      void this.setMuted(true);
    }
    this.emit();
  }

  async setCamera(on: boolean): Promise<void> {
    if (on) {
      try {
        if (this.cameraTrack === null) {
          this.cameraTrack = await acquireVideo(this.getSettings());
        }
      } catch (error) {
        this.onError(messageOf(error));
        return;
      }
    } else {
      this.cameraTrack?.stop();
      this.cameraTrack = null;
    }
    this.local = { ...this.local, video: on };
    if (!this.local.sharingScreen) {
      await this.applyVideoTrack(on ? this.cameraTrack : null);
    }
    if (this.callId !== null) {
      void this.port.updateParticipant({ callId: this.callId, video: on }).catch(() => undefined);
    }
    this.emit();
  }

  async setScreenSharing(on: boolean): Promise<void> {
    if (on) {
      try {
        this.screenTrack = await acquireDisplay(this.getSettings());
      } catch (error) {
        this.onError(messageOf(error));
        return;
      }
      this.screenTrack.addEventListener?.("ended", () => {
        void this.setScreenSharing(false);
      });
      this.local = { ...this.local, sharingScreen: true };
      await this.applyVideoTrack(this.screenTrack, "screen");
    } else {
      this.screenTrack?.stop();
      this.screenTrack = null;
      this.local = { ...this.local, sharingScreen: false };
      await this.applyVideoTrack(this.local.video ? this.cameraTrack : null);
    }
    if (this.callId !== null) {
      void this.port
        .updateParticipant({ callId: this.callId, sharingScreen: on })
        .catch(() => undefined);
    }
    this.emit();
  }

  /** Re-reads device settings: swaps a changed microphone and camera. */
  async applySettings(settings: VoiceDeviceSettings): Promise<void> {
    const previousInput = this.currentInputId();
    const nextInput = settings.inputDeviceId;
    const previous = this.previousAudioProcessing;
    const audioProcessingChanged =
      previous === null ||
      previous.echoCancellation !== settings.echoCancellation ||
      previous.noiseSuppression !== settings.noiseSuppression ||
      previous.autoGainControl !== settings.autoGainControl;
    this.previousAudioProcessing = {
      echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression,
      autoGainControl: settings.autoGainControl,
    };
    if (this.micStream !== null && (previousInput !== nextInput || audioProcessingChanged)) {
      await this.reacquireMic();
    } else {
      this.applyInputVolume();
      this.enforceGateSafety();
    }
    if (this.local.video && this.cameraTrack !== null && !this.local.sharingScreen) {
      try {
        this.cameraTrack.stop();
        this.cameraTrack = await acquireVideo(settings);
        await this.applyVideoTrack(this.cameraTrack);
      } catch {
        // Keep the existing camera if the new device is unavailable.
      }
    }
    this.emit();
  }

  private previousAudioProcessing: {
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
  } | null = null;

  private currentInputId(): string | null {
    const track = this.micStream?.getAudioTracks()[0];
    return track?.getSettings?.().deviceId ?? this.getSettings().inputDeviceId ?? null;
  }

  private async reacquireMic(): Promise<void> {
    const wasMuted = this.local.muted;
    try {
      const stream = await acquireUserMedia({ settings: this.getSettings(), withVideo: false });
      this.micStream?.getTracks().forEach((track) => {
        track.stop();
      });
      this.micStream = stream;
      for (const track of stream.getAudioTracks()) {
        track.enabled = !wasMuted;
      }
      this.startLevelMeter();
      await this.applyAudioTrack(stream.getAudioTracks()[0] ?? null);
    } catch (error) {
      this.onError(messageOf(error));
    }
  }

  // ---- Peer plumbing -------------------------------------------------------

  private async onCallUpdate(call: CallView | null): Promise<void> {
    if (call === null || call.status === "ended") {
      this.enterTeardown();
      return;
    }
    this.call = call;
    if (!call.participants.some((participant) => participant.userId === this.userId)) {
      // We were removed (e.g. the call ended from another device).
      this.enterTeardown();
      return;
    }
    this.reconcile();
    this.emit();
  }

  private reconcile(): void {
    if (this.call === null) {
      return;
    }
    const remoteIds = this.call.participants
      .map((participant) => participant.userId)
      .filter((id) => id !== this.userId);
    for (const [id, peer] of this.peers) {
      if (!remoteIds.includes(id)) {
        this.closePeer(id, peer);
      }
    }
    for (const id of remoteIds) {
      if (!this.peers.has(id) && shouldOffer(this.userId, id)) {
        void this.createPeer(id, true);
      }
    }
  }

  private async createPeer(remoteId: string, initiator: boolean): Promise<Peer | null> {
    if (this.peers.has(remoteId)) {
      return this.peers.get(remoteId) ?? null;
    }
    const pc = createPeerConnection({
      iceServers: [...this.iceServers],
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    });
    const peer: Peer = {
      pc,
      stream: createMediaStream(),
      initiator,
      pendingCandidates: [],
      connection: "connecting",
    };
    this.peers.set(remoteId, peer);
    this.remoteStreams.set(remoteId, peer.stream);

    pc.onicecandidate = (event) => {
      if (event.candidate !== null && this.callId !== null) {
        void this.port
          .sendSignal({
            callId: this.callId,
            toUserId: remoteId,
            kind: "ice",
            payload: JSON.stringify(event.candidate.toJSON()),
          })
          .catch(() => undefined);
      }
    };
    pc.ontrack = (event) => {
      peer.stream.addTrack(event.track);
      this.emit();
    };
    pc.onconnectionstatechange = () => {
      peer.connection = mapConnection(pc.connectionState);
      this.emit();
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        peer.connection = "failed";
        try {
          pc.restartIce?.();
        } catch {
          // Not supported on this engine.
        }
        this.emit();
      }
    };

    if (initiator) {
      this.addTransceivers(peer);
      await this.attachLocalTracks(peer);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(createSessionDescription(offer));
      this.sendDescription(remoteId, "offer", pc.localDescription);
    }
    return peer;
  }

  private addTransceivers(peer: Peer): void {
    peer.audioTx = peer.pc.addTransceiver("audio", { direction: "sendrecv" });
    peer.videoTx = peer.pc.addTransceiver("video", { direction: "sendrecv" });
  }

  /** Replaces the sender track on each transceiver with the current local media. */
  private async attachLocalTracks(peer: Peer): Promise<void> {
    for (const transceiver of peer.pc.getTransceivers()) {
      const kind = transceiver.receiver.track?.kind ?? transceiver.sender.track?.kind;
      // A transceiver the answerer inherited from the remote offer defaults to
      // `recvonly`; without upgrading it the answer is recvonly and we never
      // send. The offerer already set `sendrecv`, so this is a no-op there.
      transceiver.direction = "sendrecv";
      if (kind === "audio" && this.micStream !== null) {
        const track = this.micStream.getAudioTracks()[0] ?? null;
        await transceiver.sender.replaceTrack(track).catch(() => undefined);
        tuneAudioSender(transceiver.sender);
      } else if (kind === "video") {
        const track = this.screenTrack ?? (this.local.video ? this.cameraTrack : null);
        await transceiver.sender.replaceTrack(track).catch(() => undefined);
        tuneVideoSender(transceiver.sender, this.screenTrack !== null);
        tuneReceiver(transceiver.receiver);
      }
    }
  }

  /**
   * The transceivers carrying a kind for a peer. The offerer created its own
   * (stored on the peer); the answerer inherited them from the remote offer, and
   * their kind is only knowable from the receiver/sender tracks.
   */
  private transceiversFor(peer: Peer, kind: "audio" | "video"): VoiceTransceiver[] {
    const stored = kind === "audio" ? peer.audioTx : peer.videoTx;
    if (stored !== undefined) {
      return [stored];
    }
    const result: VoiceTransceiver[] = [];
    for (const transceiver of peer.pc.getTransceivers()) {
      if ((transceiver.sender.track?.kind ?? transceiver.receiver.track?.kind) === kind) {
        result.push(transceiver);
      }
    }
    return result;
  }

  /** Swaps the outgoing video track across every peer without renegotiating. */
  private async applyVideoTrack(
    track: VoiceTrack | null,
    mode: "camera" | "screen" = "camera",
  ): Promise<void> {
    for (const peer of this.peers.values()) {
      for (const transceiver of this.transceiversFor(peer, "video")) {
        transceiver.direction = "sendrecv";
        await transceiver.sender.replaceTrack(track).catch(() => undefined);
        tuneVideoSender(transceiver.sender, mode === "screen");
      }
    }
  }

  private async applyAudioTrack(track: VoiceTrack | null): Promise<void> {
    for (const peer of this.peers.values()) {
      for (const transceiver of this.transceiversFor(peer, "audio")) {
        transceiver.direction = "sendrecv";
        await transceiver.sender.replaceTrack(track).catch(() => undefined);
        tuneAudioSender(transceiver.sender);
      }
    }
  }

  private sendDescription(
    remoteId: string,
    kind: "offer" | "answer",
    description: VoiceSessionDescriptionInit | null,
  ): void {
    if (description === null || this.callId === null) {
      return;
    }
    void this.port
      .sendSignal({
        callId: this.callId,
        toUserId: remoteId,
        kind,
        payload: JSON.stringify({ type: description.type, sdp: description.sdp }),
      })
      .catch(() => undefined);
  }

  private async onSignals(signals: readonly CallSignalRow[]): Promise<void> {
    const fresh = signals.filter((signal) => !this.processedSignals.has(signal.id));
    if (fresh.length === 0) {
      return;
    }
    const consumed: string[] = [];
    for (const signal of fresh) {
      this.processedSignals.add(signal.id);
      consumed.push(signal.id);
      try {
        await this.handleSignal(signal);
      } catch (error) {
        this.onError(messageOf(error));
      }
    }
    if (consumed.length > 0 && this.callId !== null) {
      void this.port
        .ackSignals({ signalIds: consumed.map((id) => id as never) })
        .catch(() => undefined);
    }
  }

  private async handleSignal(signal: CallSignalRow): Promise<void> {
    const existing = this.peers.get(signal.fromUserId);
    if (signal.kind === "offer") {
      const peer = existing ?? (await this.createPeer(signal.fromUserId, false));
      if (peer === null) {
        return;
      }
      const description = parsePayload<VoiceSessionDescriptionInit>(signal.payload);
      if (description === null) {
        return;
      }
      await peer.pc.setRemoteDescription(createSessionDescription(description));
      await this.attachLocalTracks(peer);
      await this.flushCandidates(peer);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(createSessionDescription(answer));
      this.sendDescription(signal.fromUserId, "answer", peer.pc.localDescription);
      return;
    }
    const peer = existing;
    if (peer === undefined) {
      // A candidate/answer before we created the peer: drop it; a fresh offer
      // (or ICE restart) will follow.
      return;
    }
    if (signal.kind === "answer") {
      const description = parsePayload<VoiceSessionDescriptionInit>(signal.payload);
      if (description !== null && peer.pc.signalingState === "have-local-offer") {
        await peer.pc.setRemoteDescription(createSessionDescription(description));
        await this.flushCandidates(peer);
      }
      return;
    }
    if (signal.kind === "ice") {
      const candidate = parsePayload<VoiceIceCandidateInit>(signal.payload);
      if (candidate === null) {
        return;
      }
      if (peer.pc.remoteDescription === null) {
        peer.pendingCandidates.push(candidate);
      } else {
        await peer.pc.addIceCandidate(createIceCandidate(candidate)).catch(() => undefined);
      }
      return;
    }
    if (signal.kind === "renegotiate") {
      // Only the offerer initiates; the other side applies the fresh offer.
      if (shouldOffer(this.userId, signal.fromUserId)) {
        const description = parsePayload<VoiceSessionDescriptionInit>(signal.payload);
        if (description !== null) {
          await peer.pc.setRemoteDescription(createSessionDescription(description));
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(createSessionDescription(answer));
          this.sendDescription(signal.fromUserId, "answer", peer.pc.localDescription);
        }
      }
    }
  }

  private async flushCandidates(peer: Peer): Promise<void> {
    const pending = peer.pendingCandidates.splice(0, peer.pendingCandidates.length);
    for (const candidate of pending) {
      await peer.pc.addIceCandidate(createIceCandidate(candidate)).catch(() => undefined);
    }
  }

  private closePeer(remoteId: string, peer: Peer): void {
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.oniceconnectionstatechange = null;
    peer.pc.close();
    for (const track of peer.stream.getTracks()) {
      peer.stream.removeTrack(track);
    }
    this.peers.delete(remoteId);
    this.remoteStreams.delete(remoteId);
    this.remoteLevels.delete(remoteId);
    this.emit();
  }

  private closeAllPeers(): void {
    for (const [id, peer] of [...this.peers]) {
      this.closePeer(id, peer);
    }
    this.peers.clear();
    this.remoteStreams.clear();
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
}

/** Rough connection state mapping for the participant tiles. */
function mapConnection(state: string): PeerConnectionState {
  switch (state) {
    case "connected":
      return "connected";
    case "failed":
    case "closed":
      return "failed";
    case "disconnected":
      return "reconnecting";
    default:
      return "connecting";
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "The call ran into a problem. Please try again.";
}

/**
 * Voice-tuned Opus: in-band FEC on, stereo off, a tight bitrate cap and high
 * network priority. All parameters are best-effort across native builds.
 */
function tuneAudioSender(sender: {
  getParameters(): {
    encodings?: { maxBitrate?: number; networkPriority?: string }[];
    degradationPreference?: string;
  };
  setParameters(parameters: unknown): Promise<void>;
}): void {
  try {
    const params = sender.getParameters();
    params.encodings =
      params.encodings !== undefined && params.encodings.length > 0 ? params.encodings : [{}];
    const encoding = params.encodings[0];
    if (encoding !== undefined) {
      encoding.maxBitrate = 40_000;
      encoding.networkPriority = "high";
    }
    params.degradationPreference = "balanced";
    void sender.setParameters(params).catch(() => undefined);
  } catch {
    // Older engines expose read-only parameters.
  }
}

/**
 * Video tuning. Screen share prioritizes resolution so text stays legible;
 * camera prioritizes framerate. The cap keeps a share from starving audio.
 */
function tuneVideoSender(
  sender: {
    getParameters(): {
      encodings?: { maxBitrate?: number; maxFramerate?: number }[];
      degradationPreference?: string;
    };
    setParameters(parameters: unknown): Promise<void>;
  },
  screen: boolean,
): void {
  try {
    const params = sender.getParameters();
    params.encodings =
      params.encodings !== undefined && params.encodings.length > 0 ? params.encodings : [{}];
    const encoding = params.encodings[0];
    if (encoding !== undefined) {
      encoding.maxBitrate = screen ? 3_000_000 : 1_500_000;
      encoding.maxFramerate = 30;
    }
    params.degradationPreference = screen ? "maintain-resolution" : "maintain-framerate";
    void sender.setParameters(params).catch(() => undefined);
  } catch {
    // Best-effort.
  }
}

/** Asks the native receiver to keep playout delay low for conversation. */
function tuneReceiver(receiver: { playoutDelayHint?: number; jitterBufferTarget?: number }): void {
  try {
    receiver.playoutDelayHint = 0;
  } catch {
    // Unsupported.
  }
  try {
    receiver.jitterBufferTarget = 0;
  } catch {
    // Unsupported.
  }
}
