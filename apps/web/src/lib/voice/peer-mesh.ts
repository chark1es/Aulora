/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import {
  type CallSignalRow,
  type PeerConnectionState,
  shouldOffer,
  type VoiceDeviceSettings,
} from "@aulora/core";
import { messageOf } from "./call-errors";
import { IceSignalBuffer } from "./ice-buffer";
import { createLevelMeter } from "./media";
import { type PeerLinkStats, type RtpCounters, type RtpStatsSample, summarizeStats } from "./stats";

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
    /**
     * Additional payloads carried by the same signal. Only ICE batches use it;
     * `payload` repeats the first entry for older backends.
     */
    payloads?: readonly string[];
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
  /** The camera the user asked for: the budget a single peer would get. */
  getCameraProfile(): ScreenBudget;
  /**
   * A remote participant's audio level, at meter rate. Kept out of `onChange`:
   * it must not rebuild the call snapshot ten times a second.
   */
  onRemoteLevel(userId: string, level: number): void;
  /** The screen-share codec preference, applied to the mesh video transceiver. */
  getVideoCodec(): VideoCodecPreference;
}

/** The user's screen-share codec choice, or `auto` to let the browser default. */
export type VideoCodecPreference = VoiceDeviceSettings["screenCodec"];

/** What a screen share may spend, per viewer. */
export interface ScreenBudget {
  readonly maxBitrate: number;
  readonly frameRate: number;
}

/** What one peer's encoder is told for the video it receives from us. */
export interface VideoTuning {
  readonly maxBitrate: number;
  readonly maxFramerate: number;
  /** 1 keeps the captured size; higher values scale it down before frames drop. */
  readonly scaleResolutionDownBy: number;
  readonly degradationPreference: RTCDegradationPreference;
}

/**
 * A share is encoded once per viewer, so the whole mesh upload is capped at this
 * many full-quality copies and each viewer's copy thins out beyond that. The
 * floor keeps text legible: below roughly a megabit a 1080p desktop becomes a
 * slideshow, so the resolution ladder (not the bitrate) is what gives way.
 */
const SCREEN_COPIES = 3;
export const MIN_SCREEN_BITRATE = 900_000;

/** One viewer's share of the budget: full quality for a few viewers, then thinner. */
export function screenBitrateFor(budget: ScreenBudget, viewers: number): number {
  const shared = (budget.maxBitrate * SCREEN_COPIES) / Math.max(1, viewers);
  return Math.round(Math.min(budget.maxBitrate, Math.max(MIN_SCREEN_BITRATE, shared)));
}

/**
 * The resolution ladder for a share. Instead of squeezing the bitrate until the
 * encoder drops frames (a slideshow under `maintain-resolution`), shrink the
 * picture in steps; the frame rate stays at the profile's rate at every step.
 */
export function screenScaleFor(viewers: number): number {
  if (viewers <= SCREEN_COPIES) {
    return 1;
  }
  if (viewers <= 5) {
    return 1.5;
  }
  if (viewers <= 8) {
    return 2;
  }
  return 3;
}

/** The smallest camera bitrate the policy will ask for, whatever the mesh size. */
export const MIN_CAMERA_BITRATE = 200_000;

/**
 * Camera encoder limits by how many peers receive the camera.
 *
 * Every peer gets its own encode, so a 720p30 @1.5 Mbps camera on a six-person
 * call would ask for nine megabits up. Thin every copy as the mesh grows:
 * bitrate first, then frame rate and resolution a step at a time, so a busy
 * call shows smooth-ish faces instead of a frozen uplink. `maintain-framerate`
 * keeps the camera lifelike when the network tightens.
 */
export function cameraTuningFor(budget: ScreenBudget, receivers: number): VideoTuning {
  const peers = Math.max(1, receivers);
  const factor = peers === 1 ? 1 : peers <= 3 ? 0.75 : peers <= 5 ? 0.5 : 0.35;
  const frameRate =
    peers === 1
      ? budget.frameRate
      : Math.min(budget.frameRate, peers <= 3 ? 24 : peers <= 5 ? 20 : 15);
  return {
    maxBitrate: Math.max(MIN_CAMERA_BITRATE, Math.round(budget.maxBitrate * factor)),
    maxFramerate: frameRate,
    scaleResolutionDownBy: peers <= 3 ? 1 : peers <= 5 ? 1.5 : 2,
    degradationPreference: "maintain-framerate",
  };
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
  /** Cumulative RTP counters per peer, so loss is measured per interval. */
  private readonly statBaselines = new Map<string, RtpCounters>();
  private readonly ice: IceSignalBuffer;

  /** False while a streaming server carries the call's audio. */
  private remoteAudioEnabled = true;

  constructor(private readonly host: PeerMeshHost) {
    this.ice = new IceSignalBuffer((toUserId, payloads) => {
      const callId = this.host.getCallId();
      if (callId === null) {
        return;
      }
      void this.host
        .sendSignal({
          callId,
          toUserId,
          kind: "ice",
          payload: payloads[0] ?? "{}",
          ...(payloads.length > 1 ? { payloads } : {}),
        })
        .catch(() => undefined);
    });
  }

  /** Drops every connection and all per-call bookkeeping. */
  reset(): void {
    this.closeAllPeers();
    this.ice.clear();
    this.remoteSpeaking.clear();
    this.processedSignals.clear();
    this.remoteAudioEnabled = true;
  }

  /**
   * Silences (or restores) every remote mesh audio track without tearing the
   * peer connections down. Used for the hand-over to a streaming server: the
   * mesh keeps video signalling and the fallback path ready, but only one of
   * the two paths may play or upload audio at a time.
   */
  setRemoteAudioEnabled(enabled: boolean): void {
    this.remoteAudioEnabled = enabled;
    for (const peer of this.peers.values()) {
      for (const track of peer.stream.getAudioTracks()) {
        track.enabled = enabled;
      }
    }
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
    // A snapshot, for the same reason as `applyAudioTrack`.
    for (const [peerId, peer] of [...this.peers]) {
      const track = this.host.getVideoTrack(peerId);
      const tuning = this.videoTuning(peerId, viewers);
      for (const transceiver of this.transceiversFor(peer, "video")) {
        if (transceiver.sender.track !== track) {
          transceiver.direction = "sendrecv";
          await transceiver.sender.replaceTrack(track).catch(() => undefined);
        }
        // Retune even when the track is unchanged: the viewer count may have moved.
        tuneVideoSender(transceiver.sender, tuning);
      }
    }
  }

  /** What to send this peer: a screen share's ladder, or the adaptive camera. */
  private videoTuning(peerId: string, viewers: number): VideoTuning {
    const screen = this.screenTuning(peerId, viewers);
    if (screen !== null) {
      return screen;
    }
    return cameraTuningFor(this.host.getCameraProfile(), this.peers.size);
  }

  /** The encoder limits for what this peer receives; `null` means a camera. */
  private screenTuning(peerId: string, viewers: number): VideoTuning | null {
    if (!this.host.isScreenSharing(peerId)) {
      return null;
    }
    const budget = this.host.getScreenProfile();
    return {
      maxBitrate: screenBitrateFor(budget, viewers),
      maxFramerate: budget.frameRate,
      scaleResolutionDownBy: screenScaleFor(viewers),
      // Text stays sharp: the ladder shrinks the picture instead of letting the
      // encoder throw frames away to hold the resolution.
      degradationPreference: "maintain-resolution",
    };
  }

  async applyAudioTrack(track: MediaStreamTrack | null): Promise<void> {
    // A snapshot: the awaits below can outlive the call, and the live map may by
    // then hold the next call's peers, which this update must not touch.
    for (const peer of [...this.peers.values()]) {
      for (const transceiver of this.transceiversFor(peer, "audio")) {
        transceiver.direction = "sendrecv";
        await transceiver.sender.replaceTrack(track).catch(() => undefined);
        tuneAudioSender(transceiver.sender);
      }
    }
  }

  /**
   * Samples every peer's inbound audio for loss, RTT and jitter. Meant for a
   * low-frequency timer in an active call; each report is read once and the
   * cumulative counters are kept so loss is measured over the interval.
   */
  async collectStats(): Promise<Map<string, PeerLinkStats>> {
    const result = new Map<string, PeerLinkStats>();
    for (const [peerId, peer] of this.peers) {
      try {
        const report = await peer.pc.getStats();
        const samples: RtpStatsSample[] = [];
        report.forEach((entry) => {
          samples.push(entry);
        });
        const summarized = summarizeStats(samples, this.statBaselines.get(peerId) ?? null);
        if (summarized === null) {
          continue;
        }
        this.statBaselines.set(peerId, summarized.counters);
        result.set(peerId, summarized.stats);
      } catch {
        // A closing connection reports nothing; try again next tick.
      }
    }
    return result;
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
      if (event.candidate !== null) {
        // Pooled for a few tens of milliseconds so one gather costs one signal.
        this.ice.add(remoteId, JSON.stringify(event.candidate.toJSON()));
      }
    };
    pc.ontrack = (event) => {
      peer.stream.addTrack(event.track);
      if (event.track.kind === "audio") {
        // A track that arrives during an SFU hand-over must stay silent until
        // the mesh takes the call back.
        event.track.enabled = this.remoteAudioEnabled;
        peer.levelUnsub?.();
        peer.levelUnsub = createLevelMeter(peer.stream, (level) => {
          this.host.onRemoteLevel(remoteId, level);
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
      await pc.setLocalDescription(await withOpusVoice(pc.createOffer()));
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
        applyVideoCodecs(transceiver, this.host.getVideoCodec());
        await transceiver.sender
          .replaceTrack(this.host.getVideoTrack(remoteId))
          .catch(() => undefined);
        tuneVideoSender(transceiver.sender, this.videoTuning(remoteId, this.screenViewers()));
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
      await peer.pc.setLocalDescription(await withOpusVoice(peer.pc.createAnswer()));
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
      await peer.pc.setLocalDescription(await withOpusVoice(peer.pc.createAnswer()));
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
    this.ice.drop(remoteId);
    this.statBaselines.delete(remoteId);
    this.host.onRemoteLevel(remoteId, 0);
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
 *
 * `setParameters` has no way to reach Opus fmtp attributes, so the FEC/DTX/
 * stereo defaults are written into the local SDP (see
 * {@link applyOpusVoiceParams}) and this keeps the bitrate side.
 */
function tuneAudioSender(sender: RTCRtpSender): void {
  try {
    const params = sender.getParameters();
    params.encodings = params.encodings.length > 0 ? params.encodings : [{}];
    const encoding = params.encodings[0];
    if (encoding !== undefined) {
      encoding.maxBitrate = 40_000;
      // Chromium-only field that the DOM typings do not carry.
      const prioritised = encoding as RTCRtpEncodingParameters & { networkPriority?: string };
      prioritised.networkPriority = "high";
    }
    params.degradationPreference = "balanced";
    void sender.setParameters(params).catch(() => undefined);
  } catch {
    // Older engines expose read-only parameters.
  }
}

/** `a=rtpmap:<pt> opus/48000/2` in either CRLF or LF SDP. */
const OPUS_RTPMAP = /^a=rtpmap:(\d+) opus\/48000\/2\s*$/i;
const FMTP_LINE = /^a=fmtp:(\d+)\s?(.*)$/i;

/** The Opus parameters every Aulora sender asks for. */
const OPUS_VOICE_PARAMS: Readonly<Record<string, string>> = {
  useinbandfec: "1",
  usedtx: "1",
  stereo: "0",
};

/** Folds the voice parameters into one `a=fmtp` parameter string, keeping others. */
function mergeOpusParams(params: string): string {
  const merged = new Map<string, string>();
  for (const part of params.split(";")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const equals = trimmed.indexOf("=");
    const key = (equals === -1 ? trimmed : trimmed.slice(0, equals)).trim().toLowerCase();
    const value = equals === -1 ? "" : trimmed.slice(equals + 1).trim();
    merged.set(key, value);
  }
  for (const [key, value] of Object.entries(OPUS_VOICE_PARAMS)) {
    merged.set(key, value);
  }
  return [...merged]
    .map(([key, value]) => (value.length === 0 ? key : `${key}=${value}`))
    .join(";");
}

/** Rewrites the fmtp lines of one audio media section; other sections are untouched. */
function tuneAudioSection(lines: readonly string[]): string[] {
  if (!(lines[0] ?? "").startsWith("m=audio")) {
    return [...lines];
  }
  const types = new Set<string>();
  for (const line of lines) {
    const match = OPUS_RTPMAP.exec(line);
    if (match?.[1] !== undefined) {
      types.add(match[1]);
    }
  }
  if (types.size === 0) {
    return [...lines];
  }
  const tuned = new Set<string>();
  const result = lines.map((line) => {
    const match = FMTP_LINE.exec(line);
    if (match === null || match[1] === undefined || !types.has(match[1])) {
      return line;
    }
    tuned.add(match[1]);
    return `a=fmtp:${match[1]} ${mergeOpusParams(match[2] ?? "")}`;
  });
  let insertAt = result.length;
  while (insertAt > 0 && (result[insertAt - 1] ?? "").trim().length === 0) {
    insertAt -= 1;
  }
  const missing = [...types]
    .filter((type) => !tuned.has(type))
    .map((type) => `a=fmtp:${type} ${mergeOpusParams("")}`);
  result.splice(insertAt, 0, ...missing);
  return result;
}

/** Applies {@link applyOpusVoiceParams} to a freshly created offer or answer. */
async function withOpusVoice(
  created: Promise<RTCSessionDescriptionInit>,
): Promise<RTCSessionDescriptionInit> {
  const description = await created;
  if (typeof description.sdp !== "string" || description.sdp.length === 0) {
    return description;
  }
  return { type: description.type, sdp: applyOpusVoiceParams(description.sdp) };
}

/**
 * Adds `useinbandfec=1; usedtx=1; stereo=0` to every Opus payload in the local
 * SDP. FEC lets a receiver repair an isolated lost packet from the next one and
 * DTX stops sending during silence, which is what the old comment promised and
 * nothing configured.
 *
 * Only our own local description is rewritten (the answerer's fmtp governs the
 * offerer's encoder), and unknown Opus parameters are preserved. A peer that
 * does not understand these attributes ignores them, as RFC 7587 requires, so
 * this stays interoperable with other clients.
 */
export function applyOpusVoiceParams(sdp: string): string {
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  const lines = sdp.split(/\r\n|\n/);
  const out: string[] = [];
  let section: string[] = [];
  const flush = () => {
    if (section.length > 0) {
      out.push(...tuneAudioSection(section));
    }
    section = [];
  };
  for (const line of lines) {
    if (line.startsWith("m=")) {
      flush();
    }
    if (section.length === 0 && !line.startsWith("m=") && !line.startsWith("a=")) {
      // Session-level lines (v=, o=, s=, t=) stay where they are.
      out.push(line);
      continue;
    }
    section.push(line);
  }
  flush();
  return out.join(eol);
}

/**
 * Video tuning. A screen share keeps the frame rate and gives up resolution in
 * steps instead, and prioritizes resolution so text stays legible; a camera
 * prioritizes framerate. The cap keeps video from starving audio on a thin
 * uplink.
 */
function tuneVideoSender(sender: RTCRtpSender, tuning: VideoTuning | null): void {
  try {
    const params = sender.getParameters();
    params.encodings = params.encodings.length > 0 ? params.encodings : [{}];
    const encoding = params.encodings[0];
    if (encoding !== undefined) {
      encoding.maxBitrate = tuning?.maxBitrate ?? 1_500_000;
      encoding.maxFramerate = tuning?.maxFramerate ?? 30;
      encoding.scaleResolutionDownBy = tuning?.scaleResolutionDownBy ?? 1;
    }
    params.degradationPreference = tuning?.degradationPreference ?? "maintain-framerate";
    void sender.setParameters(params).catch(() => undefined);
  } catch {
    // Best-effort.
  }
}

/**
 * The codec order to ask the video transceiver for. VP9 encodes a mostly-static
 * desktop screen better than VP8 at the same bitrate in Chromium; WebKit
 * (Safari, WebKitGTK) has no VP9 encoder and ships H.264 hardware paths, so it
 * gets H.264 first. VP8 stays the universal fallback.
 */
export function preferredVideoCodecs(
  codec: VideoCodecPreference,
  webKit: boolean,
): readonly string[] {
  const fallback = "video/VP8";
  switch (codec) {
    case "av1":
      return ["video/AV1", "video/VP9", fallback];
    case "vp9":
      return ["video/VP9", fallback];
    case "h264":
      return ["video/H264", fallback];
    default:
      return webKit ? ["video/H264", "video/VP9", fallback] : ["video/VP9", "video/H264", fallback];
  }
}

/** Whether the engine is WebKit rather than Chromium, by user agent. */
export function prefersH264ByDefault(userAgent: string): boolean {
  return /AppleWebKit/i.test(userAgent) && !/(Chrome|Chromium|Edg)\//i.test(userAgent);
}

/** One codec capability as `getCapabilities` reports it. */
export type VideoCodecCapability = RTCRtpCapabilities["codecs"][number];

/** Orders the engine's codec capabilities by preference, keeping the rest after. */
export function orderVideoCodecs(
  codecs: readonly VideoCodecCapability[],
  preferred: readonly string[],
): VideoCodecCapability[] {
  const rank = (mimeType: string): number => {
    const index = preferred.findIndex((entry) => entry.toLowerCase() === mimeType.toLowerCase());
    return index === -1 ? preferred.length : index;
  };
  return [...codecs].sort((a, b) => rank(a.mimeType) - rank(b.mimeType));
}

/**
 * Asks the transceiver for the preferred codec order. Best-effort: engines
 * without codec control, or a transceiver that already negotiated, keep their
 * default and the call carries on.
 */
function applyVideoCodecs(transceiver: RTCRtpTransceiver, codec: VideoCodecPreference): void {
  if (typeof transceiver.setCodecPreferences !== "function") {
    return;
  }
  if (typeof RTCRtpSender === "undefined" || typeof RTCRtpSender.getCapabilities !== "function") {
    return;
  }
  const capabilities = RTCRtpSender.getCapabilities("video");
  if (capabilities === null || capabilities.codecs.length === 0) {
    return;
  }
  const webKit = prefersH264ByDefault(typeof navigator === "undefined" ? "" : navigator.userAgent);
  try {
    transceiver.setCodecPreferences(
      orderVideoCodecs(capabilities.codecs, preferredVideoCodecs(codec, webKit)),
    );
  } catch {
    // The browser refused the list (e.g. after negotiation); the default stands.
  }
}

/**
 * A modest jitter buffer target, in milliseconds.
 *
 * Pinning the buffer to zero (`playoutDelayHint = 0` plus a zero target) turns
 * jitter-buffer adaptation off, so every late or lost packet becomes concealment
 * work on the audio thread: clicks, warble and video stalls on any link that is
 * not perfectly smooth. ~150 ms keeps cancellation, clock-drift correction and
 * loss concealment working while staying inside conversational latency.
 */
export const JITTER_BUFFER_TARGET_MS = 150;

/**
 * Asks the browser for a modest jitter buffer, leaving its own default where the
 * property is absent. Exported for the tuning test.
 */
export function tuneReceiver(receiver: RTCRtpReceiver): void {
  const target = receiver as RTCRtpReceiver & { jitterBufferTarget?: number };
  if (!("jitterBufferTarget" in target)) {
    return;
  }
  try {
    target.jitterBufferTarget = JITTER_BUFFER_TARGET_MS;
  } catch {
    // Read-only or unsupported on this engine; the browser default stands.
  }
}
