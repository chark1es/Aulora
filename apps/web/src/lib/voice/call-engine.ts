/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import {
  type CallKind,
  type CallSeatResult,
  type CallView,
  isCallElsewhereError,
  isOnThisDevice,
  type SfuAccess,
  streamProfile,
  type VoiceDeviceSettings,
  type VoicePort,
  type VoiceSubscriptions,
} from "@aulora/core";
import { mediaMessage, messageOf } from "./call-errors";
import type { VoiceEngineOptions, VoiceLocalState, VoiceSnapshot } from "./call-types";
import { IceServerSource } from "./ice-servers";
import { LocalCamera } from "./local-camera";
import { applySinkId, createLevelMeter } from "./media";
import { type MicPipeline, micProcessingKey, openMicPipeline } from "./mic-pipeline";
import { DEFAULT_ICE, PeerMesh } from "./peer-mesh";
import { ScreenShare } from "./screen-share";
import { SfuCall } from "./sfu-call";
import {
  type CallTransport,
  capabilitiesOf,
  decideTransport,
  SFU_CALL_CAPABILITY,
  SFU_CALL_ENABLED,
  SFU_CALL_THRESHOLD,
} from "./sfu-call-policy";

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
/** Back-off before retrying a failed switch to the streaming server. */
const SFU_RETRY_MS = 30_000;

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
  /** Deployment ICE overrides plus the ephemeral TURN credential for this call. */
  private readonly ice: IceServerSource;
  /** Microphone and camera over the streaming server while a call is large. */
  private readonly sfu: SfuCall;
  private transport: CallTransport = "mesh";
  /** Cached per call: `null` until the backend is asked once. */
  private sfuConfigured: boolean | null = null;
  private sfuAccess: SfuAccess | null = null;
  private sfuProbe: Promise<boolean> | null = null;
  private sfuSwitching = false;
  /** Do not retry a failed switch before this timestamp. */
  private sfuRetryAt = 0;
  /** Remote users speaking on the SFU path, merged with the mesh's set. */
  private readonly sfuSpeaking = new Set<string>();
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
    this.ice = new IceServerSource({
      base: () => this.getIceServers(),
      fetchTurn: async () => (await this.port.turnCredentials?.()) ?? null,
      // A credential that arrives after peers exist cannot change their
      // already-gathered candidates, but it applies to every new peer.
      onChange: () => {
        this.emit();
      },
    });
    this.mesh = new PeerMesh({
      userId: this.userId,
      getCallId: () => this.callId,
      getIceServers: () => this.ice.current(),
      sendSignal: (signal) => this.port.sendSignal(signal),
      ackSignals: (signalIds) =>
        this.port.ackSignals({ signalIds: signalIds.map((id) => id as never) }),
      onError: (message) => {
        this.onError(message);
      },
      onChange: () => {
        this.emit();
      },
      // While the streaming server carries the call, a new peer must not get a
      // second copy of the microphone or camera.
      getAudioTrack: () =>
        this.transport === "sfu" ? null : (this.micStream?.getAudioTracks()[0] ?? null),
      getVideoTrack: (peerId) =>
        this.screen.trackForPeer(peerId) ??
        (this.local.video && this.transport !== "sfu" ? this.camera.track : null),
      isScreenSharing: (peerId) => this.screen.trackForPeer(peerId) !== null,
      getScreenProfile: () => {
        const profile = streamProfile(this.getSettings().streamQuality);
        return { maxBitrate: profile.maxBitrate, frameRate: profile.frameRate };
      },
    });
    this.sfu = new SfuCall();
    this.camera = new LocalCamera({
      onError: (message) => {
        this.onError(message);
      },
      onFailed: () => {
        // The effect broke mid-call: carry on with the plain camera.
        this.camera.fallBack();
        if (this.transport === "sfu") {
          void this.sfu.setCamera(this.camera.track);
        }
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
    readonly sfuCall?: boolean;
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
      remoteStreams: this.transport === "sfu" ? this.sfu.mediaStreams : this.mesh.remoteStreams,
      remoteScreens: this.screen.relayed,
      remoteSpeaking: this.transport === "sfu" ? this.sfuSpeaking : this.mesh.remoteSpeaking,
      attachRemoteVideo: this.attachRemoteVideo,
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

  /**
   * Binds a tile's video element to the SFU subscriber while the streaming
   * server carries the call. Stable identity: the tile effect re-runs only
   * when its stream changes.
   */
  private readonly attachRemoteVideo = (
    userId: string,
    element: HTMLVideoElement | null,
  ): boolean => (this.transport === "sfu" ? this.sfu.attachVideo(userId, element) : false);

  /** Speaking ring for the SFU path, with the same hysteresis as the mesh. */
  private setSfuLevel(userId: string, level: number): void {
    const speaking = this.sfuSpeaking.has(userId);
    const next = speaking ? level > 0.035 : level > 0.08;
    if (next === speaking) {
      return;
    }
    if (next) {
      this.sfuSpeaking.add(userId);
    } else {
      this.sfuSpeaking.delete(userId);
    }
    this.emit();
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
    void this.port
      .updateParticipant({
        callId,
        muted: settings.joinMuted,
        ...(SFU_CALL_ENABLED ? { sfuCall: true } : {}),
      })
      .catch(() => undefined);
    void this.screen.probe();
    void this.ice.load();
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
    this.ice.dispose();
    void this.sfu.disconnect();
    this.transport = "mesh";
    this.sfuAccess = null;
    this.sfuConfigured = null;
    this.sfuProbe = null;
    this.sfuSwitching = false;
    this.sfuRetryAt = 0;
    this.sfuSpeaking.clear();
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
    // Track the last value pushed into the shared context so a level that only
    // jitters within a whole percent does not re-render every voice consumer
    // (the whole chat tree) on every meter tick.
    let emittedLevel = -1;
    let emittedSpeaking = false;
    this.levelUnsub = createLevelMeter(this.micStream, (level) => {
      const quantized = Math.round(level * 100) / 100;
      const transmitting = !this.local.muted && (!this.pushToTalk || this.talking);
      const speaking = transmitting && (this.localSpeaking ? level > 0.035 : level > 0.08);
      this.micLevel = quantized;
      this.localSpeaking = speaking;
      if (quantized === emittedLevel && speaking === emittedSpeaking) {
        return;
      }
      emittedLevel = quantized;
      emittedSpeaking = speaking;
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
    if (this.transport === "sfu") {
      await this.sfu.setCamera(on ? this.camera.track : null);
    }
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
      if (this.transport === "sfu") {
        await this.sfu.setCamera(this.camera.track);
      }
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
      void this.sfu.setMic(this.micStream.getAudioTracks()[0] ?? null);
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
    void this.evaluateTransport();
    // Honour "join video calls with camera on" once, as the call first arrives.
    if (!this.cameraInitialised) {
      this.cameraInitialised = true;
      if (call.kind === "video" && this.getSettings().joinWithCamera && !this.local.video) {
        void this.setCamera(true);
      }
    }
    this.emit();
  }

  // ---- Transport -----------------------------------------------------------

  /**
   * Chooses between the peer mesh and the streaming server for the call's
   * microphone and camera. Runs on every roster update, so a call that grows
   * past the threshold switches, and one that shrinks (or gains a client that
   * cannot use the SFU) returns to the mesh. The mesh stays fully connected
   * throughout, so the fallback needs no renegotiation.
   */
  private async evaluateTransport(): Promise<void> {
    if (!SFU_CALL_ENABLED) {
      return;
    }
    const call = this.call;
    if (call === null || this.callId === null) {
      return;
    }
    const capabilities = capabilitiesOf(call.participants);
    const participants = call.participants.length;
    // Cheap gate first: never probe the backend for a small or mixed call.
    if (
      participants <= SFU_CALL_THRESHOLD ||
      !capabilities.every((sources) => sources.includes(SFU_CALL_CAPABILITY))
    ) {
      await this.fallBackToMesh();
      return;
    }
    if (this.transport === "sfu" || this.sfuSwitching || Date.now() < this.sfuRetryAt) {
      return;
    }
    const configured = await this.probeSfu();
    if (
      decideTransport({
        participants,
        sfuConfigured: configured,
        capabilities,
        threshold: SFU_CALL_THRESHOLD,
      }) !== "sfu"
    ) {
      return;
    }
    this.sfuSwitching = true;
    try {
      if (!(await this.connectSfu())) {
        // Fail fast: stay on the mesh and do not hammer a down server.
        this.sfuRetryAt = Date.now() + SFU_RETRY_MS;
      }
    } finally {
      this.sfuSwitching = false;
    }
  }

  /** Asks the backend once per call whether a streaming server is available. */
  private async probeSfu(): Promise<boolean> {
    if (this.sfuConfigured !== null) {
      return this.sfuConfigured;
    }
    if (this.sfuProbe !== null) {
      return await this.sfuProbe;
    }
    const callId = this.callId;
    if (callId === null) {
      return false;
    }
    this.sfuProbe = (async () => {
      this.sfuAccess = await this.sfuAccessForCall();
      this.sfuConfigured = this.sfuAccess !== null;
      this.sfuProbe = null;
      return this.sfuConfigured;
    })();
    return await this.sfuProbe;
  }

  private async sfuAccessForCall(): Promise<SfuAccess | null> {
    const callId = this.callId;
    if (callId === null) {
      return null;
    }
    try {
      return (await this.port.sfuAccess?.({ callId, scope: "call" })) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Opens the media room and publishes the microphone and camera. The mesh is
   * only muted once this returns `true`, so a failed or slow server never
   * interrupts the call.
   */
  private async connectSfu(): Promise<boolean> {
    const access = this.sfuAccess;
    if (access === null) {
      return false;
    }
    const connected = await this.sfu.connect(
      access,
      {
        mic: this.micStream?.getAudioTracks()[0] ?? null,
        camera: this.local.video ? this.camera.track : null,
      },
      {
        onStreams: () => {
          this.emit();
        },
        onLevel: (userId, level) => {
          this.setSfuLevel(userId, level);
        },
        onLost: () => {
          void this.fallBackToMesh();
        },
      },
      {
        refreshAccess: () => this.sfuAccessForCall(),
      },
    );
    if (!connected) {
      await this.sfu.disconnect();
      return false;
    }
    this.transport = "sfu";
    // The SFU path is proven: silence the mesh in both directions so nothing
    // is heard or uploaded twice. Video follows through `getVideoTrack`.
    this.mesh.setRemoteAudioEnabled(false);
    await this.mesh.applyAudioTrack(null);
    await this.mesh.refreshVideo();
    this.emit();
    return true;
  }

  /** Returns the call to the peer mesh without dropping it. */
  private async fallBackToMesh(): Promise<void> {
    if (this.transport !== "sfu") {
      return;
    }
    this.transport = "mesh";
    this.sfuRetryAt = Date.now() + SFU_RETRY_MS;
    await this.sfu.disconnect();
    this.sfuSpeaking.clear();
    this.mesh.setRemoteAudioEnabled(true);
    await this.mesh.applyAudioTrack(this.micStream?.getAudioTracks()[0] ?? null);
    await this.mesh.refreshVideo();
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
