import {
  type CallKind,
  type CallSeatResult,
  type CallSignalRow,
  type CallView,
  isCallElsewhereError,
  isOnThisDevice,
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
  applySinkId,
  createLevelMeter,
  createMicPipeline,
  type MicPipeline,
} from "./media";

/**
 * The WebRTC mesh call engine.
 *
 * Every participant holds one `RTCPeerConnection` per peer and the media flows
 * directly between them; Convex carries only the SDP/ICE envelopes and the
 * participant roster. This keeps a self-hosted Aulora free of any media server
 * (no SFU/TURN container, no extra ports) and gives the lowest possible latency
 * for the small calls the product targets.
 *
 * Latency and quality choices baked in:
 *  - `max-bundle` + `rtcpMuxPolicy: "require"` so each peer uses one transport.
 *  - A persistent audio *and* video transceiver per peer, so toggling a camera
 *    or starting a screen share swaps tracks with **no renegotiation round-trip**.
 *  - Opus tuned for voice (40 kbps, in-band FEC); video tuned for either
 *    motion (`maintain-framerate`) or screen clarity (`maintain-resolution`).
 *  - `playoutDelayHint`/`jitterBufferTarget` pinned low where supported.
 *
 * The engine is plain TypeScript (no React) and reports every change through a
 * single `onChange` listener so the provider can mirror it into React state.
 */

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

interface Peer {
  readonly pc: RTCPeerConnection;
  readonly stream: MediaStream;
  readonly initiator: boolean;
  readonly pendingCandidates: RTCIceCandidateInit[];
  /** Transceivers the offerer created, so tracks bind to known slots. */
  audioTx?: RTCRtpTransceiver;
  videoTx?: RTCRtpTransceiver;
  connection: PeerConnectionState;
  levelUnsub: (() => void) | null;
  /** Seat generation this connection was opened against. */
  session: number;
}

const DEFAULT_ICE: readonly RTCIceServer[] = [
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

export class VoiceEngine {
  private readonly port: VoicePort;
  private readonly subscriptions: VoiceSubscriptions;
  private readonly userId: string;
  private readonly clientId: string;
  private readonly getSettings: () => VoiceDeviceSettings;
  private readonly getIceServers: () => readonly RTCIceServer[];
  private readonly onError: (message: string) => void;
  private readonly listeners = new Set<() => void>();

  private callId: string | null = null;
  private call: CallView | null = null;
  private local: VoiceLocalState = {
    muted: false,
    deafened: false,
    video: false,
    sharingScreen: false,
  };
  private micStream: MediaStream | null = null;
  private micPipeline: MicPipeline | null = null;
  private micProcessingKey = "";
  private cameraTrack: MediaStreamTrack | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  private micLevel = 0;
  private localSpeaking = false;
  private levelUnsub: (() => void) | null = null;
  private pending = false;
  private error: string | null = null;
  private mediaError: string | null = null;
  private pushToTalk = false;
  private talking = false;
  private cameraInitialised = false;

  private readonly peers = new Map<string, Peer>();
  private readonly remoteStreams = new Map<string, MediaStream>();
  private readonly remoteSpeaking = new Set<string>();
  private readonly processedSignals = new Set<string>();
  private callUnsub: (() => void) | null = null;
  private signalUnsub: (() => void) | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(options: VoiceEngineOptions) {
    this.port = options.port;
    this.subscriptions = options.subscriptions;
    this.userId = options.userId;
    this.clientId = options.clientId;
    this.getSettings = options.getSettings;
    this.getIceServers = options.getIceServers ?? (() => DEFAULT_ICE);
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

  getSnapshot(): VoiceSnapshot {
    return {
      callId: this.callId,
      call: this.call,
      local: this.local,
      micStream: this.micStream,
      localVideoTrack: this.screenTrack ?? this.cameraTrack,
      remoteStreams: this.remoteStreams,
      remoteSpeaking: this.remoteSpeaking,
      micLevel: this.micLevel,
      localSpeaking: this.localSpeaking,
      pending: this.pending,
      error: this.error,
      mediaError: this.mediaError,
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
        // Leaving is best-effort; the sweep cleans up a dropped client anyway.
      }
    }
  }

  /**
   * Tears the call down locally without a server round-trip. Used when the
   * document is going away: the leave is delivered separately with `keepalive`
   * (see `sendLeaveBeacon`), so there is nothing to await here.
   */
  abandon(): void {
    this.enterTeardown();
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
    const settings = this.getSettings();
    this.local = { ...this.local, muted: settings.joinMuted };
    this.pushToTalk = settings.pushToTalk;
    this.talking = false;
    this.cameraInitialised = false;
    await this.acquireMic();
    this.applyMicEnabled();
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
    this.closeAllPeers();
    this.stopLevelMeter();
    this.micPipeline?.stop();
    this.micPipeline = null;
    this.micStream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.micStream = null;
    this.remoteSpeaking.clear();
    this.cameraTrack?.stop();
    this.cameraTrack = null;
    this.screenTrack?.stop();
    this.screenTrack = null;
    this.remoteStreams.clear();
    this.mediaError = null;
    this.callId = null;
    this.call = null;
    this.local = { muted: false, deafened: false, video: false, sharingScreen: false };
    this.pushToTalk = false;
    this.talking = false;
    this.cameraInitialised = false;
    this.processedSignals.clear();
    this.emit();
  }

  private async acquireMic(): Promise<void> {
    this.mediaError = null;
    try {
      const raw = await acquireUserMedia({
        settings: this.getSettings(),
        withVideo: false,
      });
      this.micPipeline = createMicPipeline(raw, this.getSettings());
      this.micStream = this.micPipeline.stream;
      this.micProcessingKey = processingKey(this.getSettings());
    } catch (error) {
      // Surface why media is unavailable; the call still connects for others.
      this.mediaError = mediaMessage(error);
      this.micStream = null;
      this.micPipeline = null;
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
    this.levelUnsub = createLevelMeter(this.micStream, (level) => {
      this.micLevel = level;
      const transmitting = !this.local.muted && (!this.pushToTalk || this.talking);
      this.localSpeaking = transmitting && (this.localSpeaking ? level > 0.035 : level > 0.08);
      this.emit();
    });
  }

  private stopLevelMeter(): void {
    this.levelUnsub?.();
    this.levelUnsub = null;
    this.micLevel = 0;
    this.localSpeaking = false;
  }

  /**
   * Tracks whether a remote peer is speaking, with hysteresis so a level
   * hovering on the threshold does not flicker the tile ring every frame.
   */
  private setRemoteLevel(userId: string, level: number): void {
    const speaking = this.remoteSpeaking.has(userId);
    const next = speaking ? level > 0.035 : level > 0.08;
    if (next === speaking) {
      return;
    }
    if (next) {
      this.remoteSpeaking.add(userId);
    } else {
      this.remoteSpeaking.delete(userId);
    }
    this.emit();
  }

  // ---- Media controls ------------------------------------------------------

  async setMuted(muted: boolean): Promise<void> {
    this.local = { ...this.local, muted };
    this.applyMicEnabled();
    if (this.callId !== null) {
      void this.port.updateParticipant({ callId: this.callId, muted }).catch(() => undefined);
    }
    this.emit();
  }

  /**
   * The microphone only transmits while allowed: not muted, and either not in
   * push-to-talk mode or actively holding the talk key. Keep the track enabled
   * (sending silence) rather than removed so no renegotiation is needed.
   */
  private applyMicEnabled(): void {
    if (this.micStream === null) {
      return;
    }
    const enabled = !this.local.muted && (!this.pushToTalk || this.talking);
    for (const track of this.micStream.getAudioTracks()) {
      track.enabled = enabled;
    }
    if (!enabled && this.localSpeaking) {
      this.localSpeaking = false;
      this.emit();
    }
  }

  /** Enables/disables push-to-talk between calls (applies to the next one). */
  setPushToTalk(on: boolean): void {
    this.pushToTalk = on;
    this.applyMicEnabled();
  }

  /** Called while the push-to-talk key is held. */
  setTalking(on: boolean): void {
    if (this.talking === on) {
      return;
    }
    this.talking = on;
    this.applyMicEnabled();
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
        this.screenTrack = await acquireDisplay({ settings: this.getSettings() });
      } catch (error) {
        // A cancelled picker is not an error worth shouting about.
        if (!isAbort(error)) {
          this.onError(messageOf(error));
        }
        return;
      }
      this.screenTrack.addEventListener("ended", () => {
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

  /** Re-reads device settings: swaps a changed microphone and rebuilds the meter. */
  async applySettings(settings: VoiceDeviceSettings): Promise<void> {
    const previousInput = this.currentInputId();
    const nextInput = settings.inputDeviceId;
    const previousProcessing = this.micProcessingKey;
    const nextProcessing = processingKey(settings);
    if (
      this.micStream !== null &&
      (previousInput !== nextInput || previousProcessing !== nextProcessing)
    ) {
      await this.reacquireMic();
    }
    this.micPipeline?.setSettings(settings);
    this.pushToTalk = settings.pushToTalk;
    this.applyMicEnabled();
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

  private currentInputId(): string | null {
    const track = this.micStream?.getAudioTracks()[0];
    return track?.getSettings().deviceId ?? this.getSettings().inputDeviceId ?? null;
  }

  private async reacquireMic(): Promise<void> {
    try {
      const raw = await acquireUserMedia({ settings: this.getSettings(), withVideo: false });
      const previousPipeline = this.micPipeline;
      const previousStream = this.micStream;
      this.micPipeline = createMicPipeline(raw, this.getSettings());
      this.micStream = this.micPipeline.stream;
      this.micProcessingKey = processingKey(this.getSettings());
      previousPipeline?.stop();
      previousStream?.getTracks().forEach((track) => {
        track.stop();
      });
      this.mediaError = null;
      this.applyMicEnabled();
      this.startLevelMeter();
      await this.applyAudioTrack(this.micStream.getAudioTracks()[0] ?? null);
    } catch (error) {
      this.mediaError = mediaMessage(error);
      this.onError(messageOf(error));
    }
  }

  /** Mirrors the local speaker choice onto any already-mounted audio element. */
  async routeOutput(elements: readonly HTMLMediaElement[]): Promise<void> {
    const deviceId = this.getSettings().outputDeviceId;
    await Promise.all(elements.map((element) => applySinkId(element, deviceId)));
  }

  // ---- Peer plumbing -------------------------------------------------------

  private async onCallUpdate(call: CallView | null): Promise<void> {
    if (call === null || call.status === "ended") {
      this.enterTeardown();
      return;
    }
    this.call = call;
    if (!isOnThisDevice(call, this.userId, this.clientId)) {
      // Removed, or another device took the seat. Do not leave: that would
      // disconnect the device that just joined.
      this.enterTeardown();
      return;
    }
    this.reconcile();
    // Honour "join video calls with camera on" once, as the call first arrives.
    if (!this.cameraInitialised) {
      this.cameraInitialised = true;
      if (call.kind === "video" && this.getSettings().joinWithCamera && !this.local.video) {
        void this.setCamera(true);
      }
    }
    this.emit();
  }

  private reconcile(): void {
    if (this.call === null) {
      return;
    }
    const remote = this.call.participants.filter(
      (participant) => participant.userId !== this.userId,
    );
    for (const [id, peer] of this.peers) {
      const participant = remote.find((entry) => entry.userId === id);
      if (participant === undefined || participant.session !== peer.session) {
        this.closePeer(id, peer);
      }
    }
    for (const participant of remote) {
      if (!this.peers.has(participant.userId) && shouldOffer(this.userId, participant.userId)) {
        void this.createPeer(participant.userId, true, participant.session);
      }
    }
  }

  private async createPeer(
    remoteId: string,
    initiator: boolean,
    session: number,
  ): Promise<Peer | null> {
    const existing = this.peers.get(remoteId);
    if (existing !== undefined) {
      if (existing.session === session) {
        return existing;
      }
      this.closePeer(remoteId, existing);
    }
    const configured = this.getIceServers();
    const pc = new RTCPeerConnection({
      iceServers: configured.length > 0 ? [...configured] : [...DEFAULT_ICE],
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    });
    const peer: Peer = {
      pc,
      stream: new MediaStream(),
      initiator,
      pendingCandidates: [],
      connection: "connecting",
      levelUnsub: null,
      session,
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
      if (event.track.kind === "audio") {
        peer.levelUnsub?.();
        peer.levelUnsub = createLevelMeter(peer.stream, (level) => {
          this.setRemoteLevel(remoteId, level);
        });
      }
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
          pc.restartIce();
        } catch {
          // Not supported on this engine.
        }
        this.emit();
      }
    };

    if (initiator) {
      peer.audioTx = pc.addTransceiver("audio", { direction: "sendrecv" });
      peer.videoTx = pc.addTransceiver("video", { direction: "sendrecv" });
      await this.attachLocalTracks(peer);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendDescription(remoteId, "offer", pc.localDescription);
    }
    return peer;
  }

  /** Replaces the sender track on each transceiver with the current local media. */
  private async attachLocalTracks(peer: Peer): Promise<void> {
    const entries: { kind: string; transceiver: RTCRtpTransceiver }[] = [];
    if (peer.audioTx !== undefined) {
      entries.push({ kind: "audio", transceiver: peer.audioTx });
    }
    if (peer.videoTx !== undefined) {
      entries.push({ kind: "video", transceiver: peer.videoTx });
    }
    if (entries.length === 0) {
      // Answerer: transceivers were created by `setRemoteDescription`.
      for (const transceiver of peer.pc.getTransceivers()) {
        const kind = transceiver.receiver.track?.kind ?? transceiver.sender.track?.kind;
        if (kind === "audio" || kind === "video") {
          entries.push({ kind, transceiver });
        }
      }
    }
    for (const { kind, transceiver } of entries) {
      // A transceiver the answerer inherited from the remote offer defaults to
      // `recvonly`; without upgrading it the answer is recvonly and we never
      // send audio/video. The offerer already set `sendrecv`, so this is a no-op
      // there.
      transceiver.direction = "sendrecv";
      if (kind === "audio") {
        const track = this.micStream?.getAudioTracks()[0] ?? null;
        await transceiver.sender.replaceTrack(track).catch(() => undefined);
        tuneAudioSender(transceiver.sender);
      } else {
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
  private transceiversFor(peer: Peer, kind: "audio" | "video"): RTCRtpTransceiver[] {
    const stored = kind === "audio" ? peer.audioTx : peer.videoTx;
    if (stored !== undefined) {
      return [stored];
    }
    const result: RTCRtpTransceiver[] = [];
    for (const transceiver of peer.pc.getTransceivers()) {
      if ((transceiver.sender.track?.kind ?? transceiver.receiver.track?.kind) === kind) {
        result.push(transceiver);
      }
    }
    return result;
  }

  /** Swaps the outgoing video track across every peer without renegotiating. */
  private async applyVideoTrack(
    track: MediaStreamTrack | null,
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

  private async applyAudioTrack(track: MediaStreamTrack | null): Promise<void> {
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
    description: RTCSessionDescription | null,
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
    if (existing !== undefined && existing.session !== signal.session && signal.kind !== "offer") {
      this.closePeer(signal.fromUserId, existing);
      return;
    }
    if (signal.kind === "offer") {
      const peer = await this.createPeer(signal.fromUserId, false, signal.session);
      if (peer === null) {
        return;
      }
      const description = parsePayload<RTCSessionDescriptionInit>(signal.payload);
      if (description === null) {
        return;
      }
      await peer.pc.setRemoteDescription(description);
      await this.attachLocalTracks(peer);
      await this.flushCandidates(peer);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
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
      const description = parsePayload<RTCSessionDescriptionInit>(signal.payload);
      if (description !== null && peer.pc.signalingState === "have-local-offer") {
        await peer.pc.setRemoteDescription(description);
        await this.flushCandidates(peer);
      }
      return;
    }
    if (signal.kind === "ice") {
      const candidate = parsePayload<RTCIceCandidateInit>(signal.payload);
      if (candidate === null) {
        return;
      }
      if (peer.pc.remoteDescription === null) {
        peer.pendingCandidates.push(candidate);
      } else {
        await peer.pc.addIceCandidate(candidate).catch(() => undefined);
      }
      return;
    }
    if (signal.kind === "renegotiate") {
      // Only the impolite side (offerer) initiates; the other side simply
      // applies a fresh offer, handled above.
      if (shouldOffer(this.userId, signal.fromUserId)) {
        const description = parsePayload<RTCSessionDescriptionInit>(signal.payload);
        if (description === null) {
          return;
        }
        await peer.pc.setRemoteDescription(description);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.sendDescription(signal.fromUserId, "answer", peer.pc.localDescription);
      }
    }
  }

  private async flushCandidates(peer: Peer): Promise<void> {
    const pending = peer.pendingCandidates.splice(0, peer.pendingCandidates.length);
    for (const candidate of pending) {
      await peer.pc.addIceCandidate(candidate).catch(() => undefined);
    }
  }

  private closePeer(remoteId: string, peer: Peer): void {
    peer.levelUnsub?.();
    this.remoteSpeaking.delete(remoteId);
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

/** Identifies the capture constraints that require a fresh `getUserMedia`. */
function processingKey(settings: VoiceDeviceSettings): string {
  return `${settings.echoCancellation ? 1 : 0}:${settings.noiseSuppression ? 1 : 0}:${
    settings.autoGainControl ? 1 : 0
  }`;
}

/** Rough connection state mapping for the participant tiles. */
function mapConnection(state: RTCPeerConnectionState): PeerConnectionState {
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

/** A clear, actionable reason media could not start. */
function mediaMessage(error: unknown): string {
  if (typeof navigator === "undefined" || navigator.mediaDevices === undefined) {
    return "Audio and video need a secure connection. Open Aulora over HTTPS or on localhost.";
  }
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone and camera access was blocked. Allow it in your browser to be heard.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No microphone was found. Connect one and rejoin the call.";
  }
  return "Couldn't start your microphone. Check your device and permissions.";
}

function isAbort(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "NotAllowedError")
  );
}

/**
 * Voice-tuned Opus: in-band FEC on, DTX on, stereo off, a tight bitrate cap and
 * high network priority. All parameters are best-effort (Safari is picky).
 */
function tuneAudioSender(sender: RTCRtpSender): void {
  try {
    const params = sender.getParameters();
    params.encodings = params.encodings.length > 0 ? params.encodings : [{}];
    const encoding = params.encodings[0];
    if (encoding !== undefined) {
      encoding.maxBitrate = 40_000;
      (encoding as { networkPriority?: string }).networkPriority = "high";
    }
    params.degradationPreference = "balanced";
    void sender.setParameters(params).catch(() => undefined);
  } catch {
    // Older engines expose read-only parameters.
  }
}

/**
 * Video tuning. Screen share prioritizes resolution so text stays legible;
 * camera prioritizes framerate. Bitrates scale with resolution by the browser,
 * but the cap keeps a share from starving the audio on a thin uplink.
 */
function tuneVideoSender(sender: RTCRtpSender, screen: boolean): void {
  try {
    const params = sender.getParameters();
    params.encodings = params.encodings.length > 0 ? params.encodings : [{}];
    const encoding = params.encodings[0];
    if (encoding !== undefined) {
      encoding.maxBitrate = screen ? 3_000_000 : 1_500_000;
      encoding.maxFramerate = screen ? 30 : 30;
    }
    params.degradationPreference = screen ? "maintain-resolution" : "maintain-framerate";
    void sender.setParameters(params).catch(() => undefined);
  } catch {
    // Best-effort.
  }
}

/** Asks the browser to keep playout delay low for interactive conversation. */
function tuneReceiver(receiver: RTCRtpReceiver): void {
  const target = receiver as RTCRtpReceiver & {
    playoutDelayHint?: number;
    jitterBufferTarget?: number;
  };
  try {
    target.playoutDelayHint = 0;
  } catch {
    // Unsupported.
  }
  try {
    target.jitterBufferTarget = 0;
  } catch {
    // Unsupported.
  }
}
