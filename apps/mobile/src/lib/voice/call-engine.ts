import { type CallSignalRow, type CallView, isOnThisDevice, shouldOffer } from "@aulora/core";
import type { Peer } from "./call-engine-core";
import {
  mapConnection,
  messageOf,
  parsePayload,
  tuneAudioSender,
  tuneReceiver,
  tuneVideoSender,
} from "./call-engine-helpers";
import { CallEngineMedia } from "./call-engine-media";
import {
  createIceCandidate,
  createMediaStream,
  createPeerConnection,
  createSessionDescription,
  type VoiceIceCandidateInit,
  type VoiceSessionDescriptionInit,
  type VoiceTrack,
  type VoiceTransceiver,
} from "./webrtc";

export type {
  MobileVoiceEngineOptions,
  MobileVoiceLocalState,
  MobileVoiceSnapshot,
} from "./call-engine-core";

/**
 * The peer mesh for {@link MobileVoiceEngine}: one connection per remote
 * participant plus the signal handling that negotiates them.
 */
export class MobileVoiceEngine extends CallEngineMedia {
  // ---- Peer plumbing -------------------------------------------------------

  protected async onCallUpdate(call: CallView | null): Promise<void> {
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
  protected transceiversFor(peer: Peer, kind: "audio" | "video"): VoiceTransceiver[] {
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
  protected async applyVideoTrack(
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

  protected async applyAudioTrack(track: VoiceTrack | null): Promise<void> {
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

  protected async onSignals(signals: readonly CallSignalRow[]): Promise<void> {
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

  protected closeAllPeers(): void {
    for (const [id, peer] of [...this.peers]) {
      this.closePeer(id, peer);
    }
    this.peers.clear();
    this.remoteStreams.clear();
  }
}
