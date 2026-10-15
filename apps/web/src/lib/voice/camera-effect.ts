/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { VoiceDeviceSettings } from "@aulora/core";
import {
  type BackgroundEffect,
  backgroundEffectsSupported,
  createBackgroundEffect,
  type EffectOptions,
} from "./effects/background-effect";

export interface CameraEffectHost {
  onError(message: string): void;
  /** The running effect broke; the engine should send the plain camera again. */
  onFailed(): void;
}

/** What the settings ask the camera to show behind the person, or `null` for nothing. */
export function effectOptions(settings: VoiceDeviceSettings): EffectOptions | null {
  switch (settings.backgroundEffect) {
    case "blur":
      return { mode: "blur", blur: settings.backgroundBlur };
    case "image":
      return { mode: "image", image: settings.backgroundImage, blur: settings.backgroundBlur };
    default:
      return null;
  }
}

/**
 * Owns the background effect for the local camera. The raw camera track stays
 * the engine's; this hands back the track to send, which is the raw one whenever
 * no effect is wanted or the effect cannot run.
 */
export class CameraEffect {
  private effect: BackgroundEffect | null = null;
  private warned = false;

  constructor(private readonly host: CameraEffectHost) {}

  /** Starts (or stops) the effect for a freshly opened camera. */
  async attach(source: MediaStreamTrack, settings: VoiceDeviceSettings): Promise<MediaStreamTrack> {
    this.release();
    const options = effectOptions(settings);
    if (options === null) {
      return source;
    }
    if (!backgroundEffectsSupported()) {
      this.warn();
      return source;
    }
    try {
      this.effect = await createBackgroundEffect(source, options, () => {
        this.release();
        this.warn();
        this.host.onFailed();
      });
      return this.effect.track;
    } catch {
      this.warn();
      return source;
    }
  }

  /** Applies changed settings to a running camera; returns the track to send now. */
  async sync(
    source: MediaStreamTrack,
    current: MediaStreamTrack,
    settings: VoiceDeviceSettings,
  ): Promise<MediaStreamTrack> {
    const options = effectOptions(settings);
    if (options === null) {
      this.release();
      return source;
    }
    if (this.effect !== null) {
      this.effect.update(options);
      return this.effect.track;
    }
    // Turned on mid-call, or retried after a failure the user has since changed.
    return current === source ? await this.attach(source, settings) : current;
  }

  release(): void {
    this.effect?.stop();
    this.effect = null;
  }

  private warn(): void {
    if (!this.warned) {
      this.warned = true;
      this.host.onError(
        "Background effects are not available on this device. Using your camera as is.",
      );
    }
  }
}
