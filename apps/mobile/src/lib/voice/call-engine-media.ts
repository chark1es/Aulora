import type { VoiceDeviceSettings } from "@aulora/core";
import { CallEngineCore, type Peer } from "./call-engine-core";
import { messageOf } from "./call-engine-helpers";
import {
  acquireDisplay,
  acquireUserMedia,
  acquireVideo,
  createLevelMeter,
  extractAudioLevel,
  setTrackVolume,
  type VoiceTrack,
  type VoiceTransceiver,
} from "./webrtc";

/**
 * Microphone, camera, screen-share and level-meter handling for the call
 * engine. Track swaps are delegated to the peer layer through the abstract
 * `apply*Track` hooks.
 */
export abstract class CallEngineMedia extends CallEngineCore {
  private previousAudioProcessing: {
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
  } | null = null;

  protected async acquireMic(): Promise<void> {
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

  protected stopLevelMeter(): void {
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
  protected startRemoteLevelHunt(): void {
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

  // ---- Hooks implemented by the peer layer ---------------------------------

  protected abstract applyAudioTrack(track: VoiceTrack | null): Promise<void>;
  protected abstract applyVideoTrack(
    track: VoiceTrack | null,
    mode?: "camera" | "screen",
  ): Promise<void>;
  protected abstract transceiversFor(peer: Peer, kind: "audio" | "video"): VoiceTransceiver[];
}
