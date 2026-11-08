/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import {
  type CallKind,
  type CallSeatResult,
  type CallView,
  DEFAULT_FEATURE_FLAGS,
  type FeatureFlags,
  isCallElsewhereError,
  isOnThisDevice,
  resolutionConstraints,
  type SfuAccess,
  streamProfile,
  type VoiceDeviceSettings,
  type VoicePort,
  type VoiceSubscriptions,
} from "@aulora/core";
import { mediaMessage, messageOf } from "./call-errors";
import type { VoiceEngineOptions, VoiceLocalState, VoiceSnapshot } from "./call-types";
import { IceServerSource } from "./ice-servers";
import { type LinkQuality, VoiceLevelsStore } from "./levels";
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
import { QualityGovernor, qualityOf, STATS_INTERVAL_MS, worstQuality } from "./stats";

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
 *  - Opus tuned for voice (40 kbps, in-band FEC, DTX); video tuned for either
 *    motion (`maintain-framerate`) or screen clarity (`maintain-resolution`).
 *  - A modest jitter-buffer target where the browser supports it, so loss
 *    concealment and clock-drift correction keep working.
 *
 * The engine is plain TypeScript (no React) and reports every change through a
 * single `onChange` listener so the provider can mirror it into React state.
 */

const HEARTBEAT_MS = 15_000;
/** Back-off before retrying a failed switch to the streaming server. */
const SFU_RETRY_MS = 30_000;
/**
 * How long joining waits for the relay credential. Peers keep the ICE servers
 * they were created with, so the credential has to be in hand before the roster
 * creates them; a slow backend must not hold the join up for longer than this.
 */
const ICE_PRELOAD_MS = 2_000;

/**
 * The camera bitrate a single peer's copy gets at each capture size. More peers
 * mean more encodes, so the mesh policy scales this down (see
 * `cameraTuningFor`). 720p30 at 1.5 Mbps is the long-standing default.
 */
const CAMERA_BITRATE: Record<VoiceDeviceSettings["videoResolution"], number> = {
  "360p": 600_000,
  "720p": 1_500_000,
  "1080p": 3_000_000,
};

export class VoiceEngine {
  private readonly port: VoicePort;
  private readonly subscriptions: VoiceSubscriptions;
  private readonly userId: string;
  private readonly clientId: string;
  private readonly getSettings: () => VoiceDeviceSettings;
  private readonly getIceServers: () => readonly RTCIceServer[];
  private readonly getFlags: () => FeatureFlags;
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
  /** The audio track peers currently receive, or `null` while we send nothing. */
  private micSending: MediaStreamTrack | null = null;
  /** Serializes sender swaps so quick mute/unmute lands in the requested order. */
  private micSync: Promise<void> = Promise.resolve();
  /** High-frequency values that must not rebuild the context value. */
  private readonly levels: VoiceLevelsStore;
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
  private sfuProbe: Promise<boolean> | null = null;
  private sfuSwitching = false;
  /**
   * Bumped every time the engine leaves or replaces a call. Work that awaits the
   * backend or the streaming server compares it afterwards so a result for a
   * call that has already ended cannot touch the next one.
   */
  private callEpoch = 0;
  /** Do not retry a failed switch before this timestamp. */
  private sfuRetryAt = 0;
  /** Last `sfuCall` value published on the roster, to avoid redundant writes. */
  private sfuCapabilityReported: boolean | null = null;
  /** Remote users speaking on the SFU path, merged with the mesh's set. */
  private readonly sfuSpeaking = new Set<string>();
  private callUnsub: (() => void) | null = null;
  private signalUnsub: (() => void) | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  /** Steps the camera down when the link stays poor (see `stats.ts`). */
  private governor = new QualityGovernor();
  /** Multiplier on the camera budget while the governor has stepped it down. */
  private cameraTrim = 1;
  private qualityNotice: string | null = null;

  constructor(options: VoiceEngineOptions) {
    this.port = options.port;
    this.subscriptions = options.subscriptions;
    this.userId = options.userId;
    this.clientId = options.clientId;
    this.getSettings = options.getSettings;
    this.getIceServers = options.getIceServers ?? (() => DEFAULT_ICE);
    this.getFlags = options.getFeatureFlags ?? (() => DEFAULT_FEATURE_FLAGS);
    this.onError = options.onError ?? (() => undefined);
    this.levels = options.levels ?? new VoiceLevelsStore();
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
      onRemoteLevel: (userId, level) => {
        this.levels.setRemoteLevel(userId, level);
      },
      // While the streaming server carries the call, a new peer must not get a
      // second copy of the microphone or camera.
      getAudioTrack: () => (this.transport === "sfu" ? null : this.micSending),
      getVideoTrack: (peerId) =>
        this.screen.trackForPeer(peerId) ??
        (this.local.video && this.transport !== "sfu" ? this.camera.track : null),
      isScreenSharing: (peerId) => this.screen.trackForPeer(peerId) !== null,
      getScreenProfile: () => {
        const profile = streamProfile(this.getSettings().streamQuality);
        return { maxBitrate: profile.maxBitrate, frameRate: profile.frameRate };
      },
      getVideoCodec: () => this.getSettings().screenCodec,
      getCameraProfile: () => {
        const resolution = this.getSettings().videoResolution;
        return {
          // What a single peer gets at this capture size; the mesh thins it,
          // and the quality governor may trim the base while the link is poor.
          maxBitrate: Math.round(CAMERA_BITRATE[resolution] * this.cameraTrim),
          frameRate: resolutionConstraints(resolution).frameRate,
        };
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

  /** Whether this client may use the streaming-server transport right now. */
  private sfuAllowed(): boolean {
    return SFU_CALL_ENABLED && !this.getFlags().disableNewCallTransport;
  }

  /**
   * Re-reads the kill switches after the server changed them. Turning the new
   * transport off returns a call in progress to the mesh; turning it back on
   * lets the next roster decision use it again.
   */
  refreshFeatureFlags(): void {
    void this.evaluateTransport();
  }

  /**
   * Publishes the SFU transport capability, once per change. Withdrawing it
   * makes every other client return the call to the mesh, so a client that
   * cannot reach the server never ends up cut off from the others.
   */
  private reportSfuCapability(capable: boolean): void {
    if (!this.sfuAllowed() || this.sfuCapabilityReported === capable) {
      return;
    }
    this.sfuCapabilityReported = capable;
    this.report({ sfuCall: capable });
  }

  /** Gives up on the streaming server for the rest of this call. */
  private disableSfu(): void {
    this.sfuConfigured = false;
    this.reportSfuCapability(false);
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
      remoteScreens: this.currentRemoteScreens(),
      remoteSpeaking: this.transport === "sfu" ? this.sfuSpeaking : this.mesh.remoteSpeaking,
      attachRemoteVideo: this.attachRemoteVideo,
      localSpeaking: this.localSpeaking,
      pending: this.pending,
      error: this.error,
      mediaError: this.mediaError,
      qualityNotice: this.qualityNotice,
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

  /**
   * The screens to render. On the mesh this is just the relayed map. On the
   * SFU path `remoteStreams` carries only the media room, so a share that still
   * travels over the mesh (the sharer cannot use the streaming server) is
   * surfaced here from the peer stream instead of disappearing.
   */
  private currentRemoteScreens(): ReadonlyMap<string, MediaStream> {
    const relayed = this.screen.relayed;
    if (this.transport !== "sfu") {
      return relayed;
    }
    const shares = new Map(relayed);
    for (const [userId, stream] of this.mesh.remoteStreams) {
      if (shares.has(userId) || stream.getVideoTracks().length === 0) {
        continue;
      }
      const sharing = this.call?.participants.some(
        (participant) => participant.userId === userId && participant.sharingScreen,
      );
      if (sharing === true) {
        shares.set(userId, stream);
      }
    }
    return shares;
  }

  /** Speaking ring for the SFU path, with the same hysteresis as the mesh. */
  private setSfuLevel(userId: string, level: number): void {
    this.levels.setRemoteLevel(userId, level);
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
    // Peers are created as soon as the roster arrives and keep the ICE servers
    // they start with, so the relay credential is fetched first.
    await this.preloadIce();
    if (this.callId !== callId) {
      return;
    }
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
    this.governor = new QualityGovernor();
    this.cameraTrim = 1;
    this.qualityNotice = null;
    this.startStatsSampler();
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
        ...(this.sfuAllowed() ? { sfuCall: true } : {}),
      })
      .catch(() => undefined);
    this.sfuCapabilityReported = this.sfuAllowed() ? true : null;
    void this.screen.probe();
    this.emit();
  }

  /** Waits briefly for the relay credential; never fails the join. */
  private async preloadIce(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ICE_PRELOAD_MS);
    });
    try {
      await Promise.race([this.ice.load(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private enterTeardown(): void {
    this.callEpoch += 1;
    this.callUnsub?.();
    this.signalUnsub?.();
    this.callUnsub = null;
    this.signalUnsub = null;
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    this.stopStatsSampler();
    this.governor = new QualityGovernor();
    this.cameraTrim = 1;
    this.qualityNotice = null;
    this.mesh.reset();
    this.ice.dispose();
    void this.sfu.disconnect();
    this.transport = "mesh";
    this.sfuConfigured = null;
    this.sfuProbe = null;
    this.sfuSwitching = false;
    this.sfuRetryAt = 0;
    this.sfuCapabilityReported = null;
    this.sfuSpeaking.clear();
    this.stopLevelMeter();
    this.levels.reset();
    this.micPipeline?.stop();
    this.micPipeline = null;
    this.micStream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.micStream = null;
    this.micSending = null;
    this.micSync = Promise.resolve();
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

  /** Routes a microphone change to whichever transport currently carries it. */
  private async applyAudioTrack(track: MediaStreamTrack | null): Promise<void> {
    if (this.transport === "sfu") {
      await this.sfu.setMic(track);
      return;
    }
    await this.mesh.applyAudioTrack(track);
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
    this.applyMicEnabled();
  }

  private startLevelMeter(): void {
    this.stopLevelMeter();
    if (this.micStream === null) {
      return;
    }
    // The level goes to the external store, which only wakes the meter that
    // reads it. The snapshot changes only when the speaking threshold is
    // crossed, so a 10 Hz meter tick no longer re-renders every voice consumer.
    this.levelUnsub = createLevelMeter(this.micStream, (level) => {
      const transmitting = !this.local.muted && (!this.pushToTalk || this.talking);
      const speaking = transmitting && (this.localSpeaking ? level > 0.035 : level > 0.08);
      this.levels.setMicLevel(level);
      if (speaking === this.localSpeaking) {
        return;
      }
      this.localSpeaking = speaking;
      this.emit();
    });
  }

  private stopLevelMeter(): void {
    this.levelUnsub?.();
    this.levelUnsub = null;
    this.levels.setMicLevel(0);
    this.localSpeaking = false;
  }

  // ---- Link quality and auto-degrade ---------------------------------------

  private startStatsSampler(): void {
    this.stopStatsSampler();
    // Only in a call, and only every few seconds: getStats walks every stream.
    this.statsTimer = setInterval(() => {
      void this.sampleStats();
    }, STATS_INTERVAL_MS);
  }

  private stopStatsSampler(): void {
    if (this.statsTimer !== null) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  /**
   * Publishes each peer's measured quality to the level store and walks the
   * conservative degrade ladder when the worst link stays poor.
   */
  private async sampleStats(): Promise<void> {
    if (this.callId === null) {
      return;
    }
    const stats = await this.mesh.collectStats();
    if (this.callId === null) {
      return;
    }
    const qualities: LinkQuality[] = [];
    for (const [peerId, link] of stats) {
      const quality = qualityOf(link);
      this.levels.setQuality(peerId, quality);
      qualities.push(quality);
    }
    if (this.getFlags().disableAutoDegrade) {
      return;
    }
    const action = this.governor.sample(worstQuality(qualities));
    if (action === "reduce") {
      this.cameraTrim = 0.5;
      this.qualityNotice =
        "Your connection is struggling, so the camera quality was lowered to keep the call clear.";
      void this.mesh.refreshVideo();
      this.emit();
    } else if (action === "audio-only") {
      this.qualityNotice =
        "Your connection is struggling, so the camera was turned off. Audio keeps going.";
      void this.setCamera(false);
    }
  }

  /** Hides the quality notice, keeping whatever reduction is in place. */
  dismissQualityNotice(): void {
    if (this.qualityNotice === null) {
      return;
    }
    this.qualityNotice = null;
    this.emit();
  }

  /** Undoes an automatic reduction and stops degrading for the rest of the call. */
  undoQualityChange(): void {
    const wasAudioOnly = this.governor.currentStage === "audioOnly";
    this.governor.suppress();
    this.cameraTrim = 1;
    this.qualityNotice = null;
    void this.mesh.refreshVideo();
    if (wasAudioOnly) {
      void this.setCamera(true);
    } else {
      this.emit();
    }
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
   * push-to-talk mode or actively holding the talk key.
   *
   * A muted sender is detached with `replaceTrack(null)` rather than left
   * sending a silent track. `track.enabled = false` still runs the Opus encoder
   * and uploads packets, which costs the uplink and keeps every peer's jitter
   * buffer busy for nothing. Detaching needs no renegotiation, so unmuting
   * re-attaches the same transceiver instantly. Swaps are serialized so a quick
   * mute/unmute cannot land out of order.
   */
  private applyMicEnabled(): void {
    const track = this.micStream?.getAudioTracks()[0] ?? null;
    const enabled = !this.local.muted && (!this.pushToTalk || this.talking);
    const wanted = enabled ? track : null;
    if (wanted === this.micSending) {
      return;
    }
    this.micSending = wanted;
    this.micSync = this.micSync.then(() => this.applyAudioTrack(wanted)).catch(() => undefined);
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
    const call = this.call;
    if (call === null || this.callId === null) {
      return;
    }
    if (!this.sfuAllowed()) {
      // Switched off (here, or by the operator): return to the mesh and tell the
      // roster, so nobody waits for this client on the streaming server.
      await this.fallBackToMesh();
      if (SFU_CALL_ENABLED && this.sfuCapabilityReported === true) {
        // `reportSfuCapability` is a no-op while disallowed; publish directly.
        this.sfuCapabilityReported = false;
        this.report({ sfuCall: false });
      }
      return;
    }
    if (this.sfuCapabilityReported === false && this.sfuConfigured !== false) {
      // The switch was turned back on and this client never lost the server.
      this.reportSfuCapability(true);
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
    this.sfuSwitching = true;
    const epoch = this.callEpoch;
    try {
      const configured = await this.probeSfu();
      if (epoch !== this.callEpoch) {
        return;
      }
      if (
        !configured ||
        decideTransport({
          participants,
          sfuConfigured: configured,
          capabilities,
          threshold: SFU_CALL_THRESHOLD,
        }) !== "sfu"
      ) {
        // This client cannot join the server. Withdraw the capability so the
        // whole call stays on the mesh; otherwise clients that did switch would
        // stop listening to its mesh audio.
        if (!configured) {
          this.reportSfuCapability(false);
        }
        return;
      }
      if (!(await this.connectSfu()) && epoch === this.callEpoch) {
        // Fail fast: stay on the mesh and do not hammer a down server.
        this.sfuRetryAt = Date.now() + SFU_RETRY_MS;
      }
    } finally {
      // A new call resets this flag itself; do not clear one that belongs to it.
      if (epoch === this.callEpoch) {
        this.sfuSwitching = false;
      }
    }
    // A roster change may have arrived during the switch; run the decision once
    // more so a participant leaving never strands the call on the SFU path.
    // This returns immediately when the choice still holds.
    if (epoch === this.callEpoch) {
      void this.evaluateTransport();
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
    const epoch = this.callEpoch;
    this.sfuProbe = (async () => {
      const access = await this.sfuAccessForCall();
      if (epoch !== this.callEpoch) {
        // The call ended meanwhile; leave the next call's state alone.
        return false;
      }
      this.sfuConfigured = access !== null;
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
    const epoch = this.callEpoch;
    try {
      const access = (await this.port.sfuAccess?.({ callId, scope: "call" })) ?? null;
      if (epoch !== this.callEpoch) {
        return null;
      }
      return access;
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
    // Re-mint rather than reuse the probe's grant: a fallback followed by a
    // retry can come hours later, after the original token expired.
    const epoch = this.callEpoch;
    const access = await this.sfuAccessForCall();
    if (access === null || epoch !== this.callEpoch) {
      return false;
    }
    const connected = await this.sfu.connect(
      access,
      {
        mic: this.micSending,
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
          void this.fallBackToMesh(SFU_RETRY_MS);
        },
      },
      {
        refreshAccess: () => this.sfuAccessForCall(),
      },
    );
    if (epoch !== this.callEpoch) {
      // The call ended while connecting. Ending it already closed the room, and
      // the next call may own the connection now, so leave it untouched.
      return false;
    }
    if (!connected) {
      await this.sfu.disconnect();
      // Tell the roster this client cannot use the server, so nobody stays on
      // the SFU path while this client's audio is only on the mesh.
      this.disableSfu();
      return false;
    }
    this.transport = "sfu";
    // The room was opened with the microphone as it was before connecting. A
    // mute or unmute during the connection only reached the mesh, so apply the
    // current decision now, in line with other microphone changes.
    const synced = this.micSync.then(() => this.sfu.setMic(this.micSending)).catch(() => undefined);
    this.micSync = synced;
    await synced;
    // The camera has the same gap: switched on or off while the room connected,
    // it reached only the mesh, which stops sending video from here on.
    await this.sfu.setCamera(this.local.video ? this.camera.track : null);
    // The SFU path is proven: silence the mesh in both directions so nothing
    // is heard or uploaded twice. Video follows through `getVideoTrack`.
    this.mesh.setRemoteAudioEnabled(false);
    await this.mesh.applyAudioTrack(null);
    await this.mesh.refreshVideo();
    this.emit();
    return true;
  }

  /** Returns the call to the peer mesh without dropping it. */
  private async fallBackToMesh(retryDelayMs = 0): Promise<void> {
    if (this.transport !== "sfu") {
      return;
    }
    this.transport = "mesh";
    if (retryDelayMs > 0) {
      this.sfuRetryAt = Date.now() + retryDelayMs;
      // A lost server is a capability loss for this call: keep everyone on the
      // mesh rather than splitting the room across two transports.
      this.disableSfu();
    }
    await this.sfu.disconnect();
    this.sfuSpeaking.clear();
    this.mesh.setRemoteAudioEnabled(true);
    await this.mesh.applyAudioTrack(this.micSending);
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
