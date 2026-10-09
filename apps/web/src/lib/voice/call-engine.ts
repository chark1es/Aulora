/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import {
  type CallKind,
  type CallSeatResult,
  type CallView,
  isCallElsewhereError,
  isOnThisDevice,
  streamProfile,
  type VoiceDeviceSettings,
  type VoicePort,
  type VoiceSubscriptions,
} from "@aulora/core";
import { mediaMessage, messageOf } from "./call-errors";
import type { VoiceEngineOptions, VoiceLocalState, VoiceSnapshot } from "./call-types";
import { LocalCamera } from "./local-camera";
import { applySinkId, createLevelMeter } from "./media";
import { type MicPipeline, micProcessingKey, openMicPipeline } from "./mic-pipeline";
import { DEFAULT_ICE, PeerMesh } from "./peer-mesh";
import { ScreenShare } from "./screen-share";

export type { VoiceEngineOptions, VoiceLocalState, VoiceSnapshot } from "./call-types";

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

const HEARTBEAT_MS = 15_000;

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
  private micLevel = 0;
  private localSpeaking = false;
  private levelUnsub: (() => void) | null = null;
  private pending = false;
  private error: string | null = null;
  private mediaError: string | null = null;
  private pushToTalk = false;
  private talking = false;
  private cameraInitialised = false;

  private readonly mesh: PeerMesh;
  private readonly screen: ScreenShare;
  private readonly camera: LocalCamera;
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
    this.onError = options.onError ?? (() => undefined);
    this.mesh = new PeerMesh({
      userId: this.userId,
      getCallId: () => this.callId,
      getIceServers: () => this.getIceServers(),
      sendSignal: (signal) => this.port.sendSignal(signal),
      ackSignals: (signalIds) =>
        this.port.ackSignals({ signalIds: signalIds.map((id) => id as never) }),
      onError: (message) => {
        this.onError(message);
      },
      onChange: () => {
        this.emit();
      },
      getAudioTrack: () => this.micStream?.getAudioTracks()[0] ?? null,
      getVideoTrack: (peerId) =>
        this.screen.trackForPeer(peerId) ?? (this.local.video ? this.camera.track : null),
      isScreenSharing: (peerId) => this.screen.trackForPeer(peerId) !== null,
      getScreenProfile: () => {
        const profile = streamProfile(this.getSettings().streamQuality);
        return { maxBitrate: profile.maxBitrate, frameRate: profile.frameRate };
      },
    });
    this.camera = new LocalCamera({
      onError: (message) => {
        this.onError(message);
      },
      onFailed: () => {
        // The effect broke mid-call: carry on with the plain camera.
        this.camera.fallBack();
        void this.mesh.refreshVideo();
        this.emit();
      },
    });
    this.screen = new ScreenShare({
      userId: this.userId,
      getSettings: () => this.getSettings(),
      getParticipants: () => this.call?.participants ?? [],
      fetchAccess: async () => {
        const callId = this.callId;
        return callId === null ? null : ((await this.port.sfuAccess?.({ callId })) ?? null);
      },
      reportCapable: (capable) => {
        this.report({ sfu: capable });
      },
      reportSharing: (sharing) => {
        this.local = { ...this.local, sharingScreen: sharing };
        this.report({ sharingScreen: sharing });
      },
      refreshMesh: () => this.mesh.refreshVideo(),
      onChange: () => {
        this.emit();
      },
      onError: (message) => {
        this.onError(message);
      },
    });
  }

  /** Publishes participant flags; the roster is advisory, so a failure is not fatal. */
  private report(flags: {
    readonly sfu?: boolean;
    readonly sharingScreen?: boolean;
    readonly video?: boolean;
  }): void {
    if (this.callId !== null) {
      void this.port.updateParticipant({ callId: this.callId, ...flags }).catch(() => undefined);
    }
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
      localVideoTrack: this.screen.track ?? this.camera.track,
      remoteStreams: this.mesh.remoteStreams,
      remoteScreens: this.screen.relayed,
      remoteSpeaking: this.mesh.remoteSpeaking,
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
    this.mesh.reset();
    const watched = callId;
    this.callUnsub = this.subscriptions.watchCallById(callId, (call) => {
      if (this.callId !== watched) {
        return;
      }
      this.onCallUpdate(call);
    });
    this.signalUnsub = this.subscriptions.watchSignals(callId, (signals) => {
      void this.mesh.handleSignals(signals);
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
    void this.screen.probe();
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
    this.mesh.reset();
    this.stopLevelMeter();
    this.micPipeline?.stop();
    this.micPipeline = null;
    this.micStream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.micStream = null;
    this.camera.close();
    void this.screen.reset();
    this.mediaError = null;
    this.callId = null;
    this.call = null;
    this.local = { muted: false, deafened: false, video: false, sharingScreen: false };
    this.pushToTalk = false;
    this.talking = false;
    this.cameraInitialised = false;
    this.emit();
  }

  private async acquireMic(): Promise<void> {
    this.mediaError = null;
    try {
      this.micPipeline = await openMicPipeline(this.getSettings());
      this.micStream = this.micPipeline.stream;
      this.micProcessingKey = micProcessingKey(this.getSettings());
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
    await this.mesh.applyAudioTrack(this.micStream.getAudioTracks()[0] ?? null);
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

  // ---- Media controls ------------------------------------------------------

  setMuted(muted: boolean): Promise<void> {
    this.local = { ...this.local, muted };
    this.applyMicEnabled();
    if (this.callId !== null) {
      void this.port.updateParticipant({ callId: this.callId, muted }).catch(() => undefined);
    }
    this.emit();
    return Promise.resolve();
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
        if (!this.camera.isOpen) {
          await this.camera.open(this.getSettings());
        }
      } catch (error) {
        this.onError(messageOf(error));
        return;
      }
    } else {
      this.camera.close();
    }
    this.local = { ...this.local, video: on };
    await this.mesh.refreshVideo();
    this.report({ video: on });
    this.emit();
  }

  async setScreenSharing(on: boolean): Promise<void> {
    if (on) {
      await this.screen.start();
    } else {
      await this.screen.stop();
    }
  }

  /** Re-reads device settings: swaps a changed microphone and rebuilds the meter. */
  async applySettings(settings: VoiceDeviceSettings): Promise<void> {
    const previousInput = this.currentInputId();
    const nextInput = settings.inputDeviceId;
    const previousProcessing = this.micProcessingKey;
    const nextProcessing = micProcessingKey(settings);
    if (
      this.micStream !== null &&
      (previousInput !== nextInput || previousProcessing !== nextProcessing)
    ) {
      await this.reacquireMic();
    }
    this.micPipeline?.setSettings(settings);
    this.pushToTalk = settings.pushToTalk;
    this.applyMicEnabled();
    if (this.local.video && (await this.camera.sync(settings))) {
      await this.mesh.refreshVideo();
    }
    this.emit();
  }

  private currentInputId(): string | null {
    const track = this.micStream?.getAudioTracks()[0];
    return track?.getSettings().deviceId ?? this.getSettings().inputDeviceId ?? null;
  }

  private async reacquireMic(): Promise<void> {
    try {
      const pipeline = await openMicPipeline(this.getSettings());
      const previousPipeline = this.micPipeline;
      const previousStream = this.micStream;
      this.micPipeline = pipeline;
      this.micStream = this.micPipeline.stream;
      this.micProcessingKey = micProcessingKey(this.getSettings());
      previousPipeline?.stop();
      previousStream?.getTracks().forEach((track) => {
        track.stop();
      });
      this.mediaError = null;
      this.applyMicEnabled();
      this.startLevelMeter();
      await this.mesh.applyAudioTrack(this.micStream.getAudioTracks()[0] ?? null);
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

  private onCallUpdate(call: CallView | null): void {
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
    this.mesh.reconcile(call.participants);
    // A viewer's streaming-server capability decides who gets the mesh copy of a
    // share, and a sharer on the server decides whether to join its room.
    this.screen.follow();
    if (this.screen.active) {
      void this.mesh.refreshVideo();
    }
    // Honour "join video calls with camera on" once, as the call first arrives.
    if (!this.cameraInitialised) {
      this.cameraInitialised = true;
      if (call.kind === "video" && this.getSettings().joinWithCamera && !this.local.video) {
        void this.setCamera(true);
      }
    }
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
}
