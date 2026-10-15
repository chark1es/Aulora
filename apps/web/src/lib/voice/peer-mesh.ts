/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { type CallSignalRow, type PeerConnectionState, shouldOffer } from "@aulora/core";
import { messageOf } from "./call-errors";
import { createLevelMeter } from "./media";

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

export const DEFAULT_ICE: readonly RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

/** Everything the mesh needs from the engine that owns it. */
export interface PeerMeshHost {
  readonly userId: string;
  getCallId(): string | null;
  getIceServers(): readonly RTCIceServer[];
  sendSignal(signal: {
    callId: string;
    toUserId: string;
    kind: "offer" | "answer" | "ice" | "renegotiate";
    payload: string;
  }): Promise<unknown>;
  ackSignals(signalIds: readonly string[]): Promise<unknown>;
  onError(message: string): void;
  onChange(): void;
  getAudioTrack(): MediaStreamTrack | null;
  /**
   * The video this peer should receive from us. It differs per peer: a share that
   * goes through the streaming server is withheld from peers who watch it there.
   */
  getVideoTrack(peerId: string): MediaStreamTrack | null;
  /** Whether the track returned for this peer is a screen share (tunes the encoder). */
  isScreenSharing(peerId: string): boolean;
  /** The chosen stream quality: the most a single viewer's copy may use. */
  getScreenProfile(): ScreenBudget;
}

/** What a screen share may spend, per viewer. */
export interface ScreenBudget {
  readonly maxBitrate: number;
  readonly frameRate: number;
}

/**
 * Sending a share to each viewer separately multiplies the upload, so the whole
 * mesh upload is capped at this many full-quality copies and each viewer's copy
 * shrinks once more people than that are watching.
 */
const SCREEN_COPIES = 3;
const MIN_SCREEN_BITRATE = 500_000;

/** One viewer's share of the budget: full quality for a few viewers, then thinner. */
export function screenBitrateFor(budget: ScreenBudget, viewers: number): number {
  const shared = (budget.maxBitrate * SCREEN_COPIES) / Math.max(1, viewers);
  return Math.round(Math.min(budget.maxBitrate, Math.max(MIN_SCREEN_BITRATE, shared)));
}

function parsePayload<T>(payload: string): T | null {
  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

/**
 * The WebRTC peer connections for one call: one `RTCPeerConnection` per remote
 * participant, the SDP/ICE signal handling that opens them, and the media-track
 * swaps that keep a camera or screen share flowing without renegotiation.
 */
export class PeerMesh {
  readonly peers = new Map<string, Peer>();
  readonly remoteStreams = new Map<string, MediaStream>();
  readonly remoteSpeaking = new Set<string>();
  private readonly processedSignals = new Set<string>();

  constructor(private readonly host: PeerMeshHost) {}

  /** Drops every connection and all per-call bookkeeping. */
  reset(): void {
    this.closeAllPeers();
    this.remoteSpeaking.clear();
    this.processedSignals.clear();
  }

  /** Opens/closes peers so they match the call's current participant list. */
  reconcile(participants: readonly { userId: string; session: number }[]): void {
    const remote = participants.filter((participant) => participant.userId !== this.host.userId);
    for (const [id, peer] of this.peers) {
      const participant = remote.find((entry) => entry.userId === id);
      if (participant === undefined || participant.session !== peer.session) {
        this.closePeer(id, peer);
      }
    }
    for (const participant of remote) {
      if (
        !this.peers.has(participant.userId) &&
        shouldOffer(this.host.userId, participant.userId)
      ) {
        void this.createPeer(participant.userId, true, participant.session);
      }
    }
  }

  async handleSignals(signals: readonly CallSignalRow[]): Promise<void> {
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
        this.host.onError(messageOf(error));
      }
    }
    if (consumed.length > 0 && this.host.getCallId() !== null) {
      void this.host.ackSignals(consumed.map((id) => id as never)).catch(() => undefined);
    }
  }

  /**
   * Re-points every peer's outgoing video at what the host wants it to receive,
   * without renegotiating. Call after the camera, a share or the roster changes.
   */
  async refreshVideo(): Promise<void> {
    const viewers = [...this.peers.keys()].filter((id) => this.host.isScreenSharing(id)).length;
    for (const [peerId, peer] of this.peers) {
      const track = this.host.getVideoTrack(peerId);
      const screen = this.screenTuning(peerId, viewers);
      for (const transceiver of this.transceiversFor(peer, "video")) {
        if (transceiver.sender.track !== track) {
          transceiver.direction = "sendrecv";
          await transceiver.sender.replaceTrack(track).catch(() => undefined);
        }
        // Retune even when the track is unchanged: the viewer count may have moved.
        tuneVideoSender(transceiver.sender, screen);
      }
    }
  }

  /** The encoder limits for what this peer receives; `null` means a camera. */
  private screenTuning(peerId: string, viewers: number): ScreenBudget | null {
    if (!this.host.isScreenSharing(peerId)) {
      return null;
    }
    const budget = this.host.getScreenProfile();
    return { ...budget, maxBitrate: screenBitrateFor(budget, viewers) };
  }

  async applyAudioTrack(track: MediaStreamTrack | null): Promise<void> {
    for (const peer of this.peers.values()) {
      for (const transceiver of this.transceiversFor(peer, "audio")) {
        transceiver.direction = "sendrecv";
        await transceiver.sender.replaceTrack(track).catch(() => undefined);
        tuneAudioSender(transceiver.sender);
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
    const configured = this.host.getIceServers();
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
      const callId = this.host.getCallId();
      if (event.candidate !== null && callId !== null) {
        void this.host
          .sendSignal({
            callId,
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
      this.host.onChange();
    };
    pc.onconnectionstatechange = () => {
      peer.connection = mapConnection(pc.connectionState);
      this.host.onChange();
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        peer.connection = "failed";
        try {
          pc.restartIce();
        } catch {
          // Not supported on this engine.
        }
        this.host.onChange();
      }
    };

    if (initiator) {
      peer.audioTx = pc.addTransceiver("audio", { direction: "sendrecv" });
      peer.videoTx = pc.addTransceiver("video", { direction: "sendrecv" });
      await this.attachLocalTracks(peer, remoteId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendDescription(remoteId, "offer", pc.localDescription);
    }
    return peer;
  }

  /** Replaces the sender track on each transceiver with the current local media. */
  private async attachLocalTracks(peer: Peer, remoteId: string): Promise<void> {
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
        const receiverTrack = transceiver.receiver.track as MediaStreamTrack | null;
        const kind = receiverTrack?.kind ?? transceiver.sender.track?.kind;
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
        await transceiver.sender.replaceTrack(this.host.getAudioTrack()).catch(() => undefined);
        tuneAudioSender(transceiver.sender);
      } else {
        await transceiver.sender
          .replaceTrack(this.host.getVideoTrack(remoteId))
          .catch(() => undefined);
        tuneVideoSender(transceiver.sender, this.screenTuning(remoteId, this.screenViewers()));
        tuneReceiver(transceiver.receiver);
      }
    }
  }

  private screenViewers(): number {
    return [...this.peers.keys()].filter((id) => this.host.isScreenSharing(id)).length;
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
      const receiverTrack = transceiver.receiver.track as MediaStreamTrack | null;
      if ((transceiver.sender.track?.kind ?? receiverTrack?.kind) === kind) {
        result.push(transceiver);
      }
    }
    return result;
  }

  private sendDescription(
    remoteId: string,
    kind: "offer" | "answer",
    description: RTCSessionDescription | null,
  ): void {
    const callId = this.host.getCallId();
    if (description === null || callId === null) {
      return;
    }
    void this.host
      .sendSignal({
        callId,
        toUserId: remoteId,
        kind,
        payload: JSON.stringify({ type: description.type, sdp: description.sdp }),
      })
      .catch(() => undefined);
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
      await this.attachLocalTracks(peer, signal.fromUserId);
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
    // Only the impolite side (offerer) initiates; the other side simply
    // applies a fresh offer, handled above.
    if (shouldOffer(this.host.userId, signal.fromUserId)) {
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
    this.host.onChange();
  }

  private closeAllPeers(): void {
    for (const [id, peer] of [...this.peers]) {
      this.closePeer(id, peer);
    }
    this.peers.clear();
    this.remoteStreams.clear();
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
    this.host.onChange();
  }
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
function tuneVideoSender(sender: RTCRtpSender, screen: ScreenBudget | null): void {
  try {
    const params = sender.getParameters();
    params.encodings = params.encodings.length > 0 ? params.encodings : [{}];
    const encoding = params.encodings[0];
    if (encoding !== undefined) {
      encoding.maxBitrate = screen?.maxBitrate ?? 1_500_000;
      encoding.maxFramerate = screen?.frameRate ?? 30;
    }
    params.degradationPreference = screen !== null ? "maintain-resolution" : "maintain-framerate";
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
