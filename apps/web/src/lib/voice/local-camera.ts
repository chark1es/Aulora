import type { VoiceDeviceSettings } from "@aulora/core";
import { CameraEffect, type CameraEffectHost } from "./camera-effect";
import { acquireVideo } from "./media";

/** Identifies the camera constraints that require a fresh capture. */
function captureKey(settings: VoiceDeviceSettings): string {
  return `${settings.cameraDeviceId ?? ""}:${settings.videoResolution}`;
}

/**
 * The local camera: the capture itself, and the background effect that may sit
 * between it and the call. `track` is what to send, which is the raw capture
 * unless an effect is running.
 */
export class LocalCamera {
  private readonly effect: CameraEffect;
  private source: MediaStreamTrack | null = null;
  private sent: MediaStreamTrack | null = null;
  private key = "";

  constructor(host: CameraEffectHost) {
    this.effect = new CameraEffect(host);
  }

  get track(): MediaStreamTrack | null {
    return this.sent;
  }

  get isOpen(): boolean {
    return this.sent !== null;
  }

  async open(settings: VoiceDeviceSettings): Promise<void> {
    const source = await acquireVideo(settings);
    this.source = source;
    this.key = captureKey(settings);
    this.sent = await this.effect.attach(source, settings);
  }

  close(): void {
    this.effect.release();
    this.source?.stop();
    this.sent?.stop();
    this.source = null;
    this.sent = null;
  }

  /** The effect broke mid-call: send the plain capture instead. */
  fallBack(): void {
    this.sent = this.source;
  }

  /**
   * Follows a settings change on an open camera. The device or resolution
   * changing needs a new capture; anything else (an effect, its strength) is
   * applied in place, so adjusting an unrelated slider never restarts the camera.
   * Returns whether the track to send changed. On failure the camera is kept.
   */
  async sync(settings: VoiceDeviceSettings): Promise<boolean> {
    const source = this.source;
    const sent = this.sent;
    if (source === null || sent === null) {
      return false;
    }
    try {
      if (captureKey(settings) === this.key) {
        this.sent = await this.effect.sync(source, sent, settings);
      } else {
        const fresh = await acquireVideo(settings);
        this.close();
        this.source = fresh;
        this.key = captureKey(settings);
        this.sent = await this.effect.attach(fresh, settings);
      }
      return true;
    } catch {
      // Keep the existing camera if the new device is unavailable.
      return false;
    }
  }
}
