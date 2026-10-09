/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { VoiceDeviceSettings } from "@aulora/core";
import noiseGateWorkletUrl from "@sapphi-red/web-noise-suppressor/noiseGateWorklet.js?url";
import rnnoiseWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimdWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import rnnoiseWorkletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import { audioContextCtor } from "./audio-context";
import { acquireUserMedia } from "./media";

/**
 * The client-side microphone chain, applied with WebAudio so the settings change
 * what peers actually hear:
 *
 *   mic -> [RNNoise] -> [noise gate] -> input gain -> processed stream
 *
 * Everything runs in an AudioWorklet on the audio thread, so it keeps working
 * when the call window is hidden or in another tab, unlike a timer-driven gate
 * which the browser throttles. RNNoise (a small recurrent network, BSD-3) removes
 * keyboard clatter, fans and room noise that the browser's own suppression
 * leaves behind. It needs 48 kHz audio and WebAssembly.
 */
export interface MicPipeline {
  readonly stream: MediaStream;
  /** Whether the learned denoiser is actually running. */
  readonly enhanced: boolean;
  setSettings(settings: VoiceDeviceSettings): void;
  stop(): void;
}

const RNNOISE_SAMPLE_RATE = 48_000;

/** Identifies the capture constraints that require a fresh `getUserMedia`. */
export function micProcessingKey(settings: VoiceDeviceSettings): string {
  return [
    settings.echoCancellation,
    settings.noiseSuppression,
    settings.enhancedNoiseSuppression,
    settings.autoGainControl,
  ]
    .map((flag) => (flag ? 1 : 0))
    .join(":");
}

type Suppressor = typeof import("@sapphi-red/web-noise-suppressor");
type GateNode = InstanceType<Suppressor["NoiseGateWorkletNode"]>;

/**
 * The library subclasses `AudioWorkletNode` when it is evaluated, so importing it
 * eagerly would throw in any browser without AudioWorklet and put it in the main
 * bundle for everyone. Load it only when a call needs it.
 */
let suppressorModule: Promise<Suppressor> | null = null;

function suppressor(): Promise<Suppressor> {
  suppressorModule ??= import("@sapphi-red/web-noise-suppressor");
  return suppressorModule;
}

/** The gate's open level in dBFS for the 0..1 slider; `null` means no gate. */
export function gateOpenThresholdDb(threshold: number): number | null {
  if (threshold <= 0) {
    return null;
  }
  return -75 + Math.min(1, threshold) * 45;
}

let rnnoiseBinary: Promise<ArrayBuffer> | null = null;

function loadBinary(): Promise<ArrayBuffer> {
  rnnoiseBinary ??= suppressor()
    .then(({ loadRnnoise }) => loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl }))
    .catch((error: unknown) => {
      // Do not cache a failure: a flaky network should be retried next call.
      rnnoiseBinary = null;
      throw error;
    });
  return rnnoiseBinary;
}

/**
 * Whether the denoiser can run here, and the model loaded if so. Called before
 * the microphone is opened: the browser's own suppression is only switched off
 * when this resolves `true`, so a failure never leaves the mic unprocessed.
 */
export async function enhancedNoiseSuppressionAvailable(): Promise<boolean> {
  if (
    audioContextCtor() === null ||
    typeof AudioWorkletNode === "undefined" ||
    typeof WebAssembly === "undefined"
  ) {
    return false;
  }
  try {
    await loadBinary();
    return true;
  } catch {
    return false;
  }
}

const NO_PIPELINE = (stream: MediaStream): MicPipeline => ({
  stream,
  enhanced: false,
  setSettings: () => {},
  stop: () => {},
});

async function createContext(enhanced: boolean): Promise<AudioContext | null> {
  const Ctor = audioContextCtor();
  if (Ctor === null) {
    return null;
  }
  try {
    const context = enhanced
      ? new Ctor({ sampleRate: RNNOISE_SAMPLE_RATE, latencyHint: "interactive" })
      : new Ctor({ latencyHint: "interactive" });
    // Not awaited: while the browser withholds audio autoplay `resume()` stays
    // pending, and joining a call must not wait on it.
    void context.resume().catch(() => undefined);
    return context;
  } catch {
    return null;
  }
}

/** Loads the worklet modules and builds the optional denoiser node. */
async function buildDenoiser(context: AudioContext, enhanced: boolean) {
  await context.audioWorklet.addModule(noiseGateWorkletUrl);
  if (!enhanced) {
    return null;
  }
  const { RnnoiseWorkletNode } = await suppressor();
  await context.audioWorklet.addModule(rnnoiseWorkletUrl);
  return new RnnoiseWorkletNode(context, { maxChannels: 1, wasmBinary: await loadBinary() });
}

function buildGate(lib: Suppressor, context: AudioContext, threshold: number): GateNode | null {
  const open = gateOpenThresholdDb(threshold);
  if (open === null) {
    return null;
  }
  return new lib.NoiseGateWorkletNode(context, {
    openThreshold: open,
    // A few dB of hysteresis stops the gate chattering on a level at the edge.
    closeThreshold: open - 6,
    holdMs: 250,
    maxChannels: 1,
  });
}

/**
 * Builds the chain for a captured microphone stream. `enhanced` should come from
 * {@link enhancedNoiseSuppressionAvailable}. Degrades to the raw stream when
 * WebAudio is missing, and to a chain without the denoiser if it fails to start.
 */
export async function createMicPipeline(
  stream: MediaStream,
  settings: VoiceDeviceSettings,
  enhanced: boolean,
): Promise<MicPipeline> {
  if (stream.getAudioTracks().length === 0) {
    return NO_PIPELINE(stream);
  }
  const context = await createContext(enhanced);
  if (context === null) {
    return NO_PIPELINE(stream);
  }
  try {
    return await assemble(context, stream, settings, enhanced);
  } catch {
    if (enhanced) {
      await context.close().catch(() => undefined);
      return createMicPipeline(stream, settings, false);
    }
    await context.close().catch(() => undefined);
    return NO_PIPELINE(stream);
  }
}

async function assemble(
  context: AudioContext,
  stream: MediaStream,
  settings: VoiceDeviceSettings,
  enhanced: boolean,
): Promise<MicPipeline> {
  const lib = await suppressor();
  const denoiser = await buildDenoiser(context, enhanced);
  const source = context.createMediaStreamSource(stream);
  const gain = context.createGain();
  gain.gain.value = settings.inputVolume;
  const destination = context.createMediaStreamDestination();
  gain.connect(destination);

  let gate: GateNode | null = null;
  let threshold = settings.noiseGateThreshold;
  const wire = () => {
    gate?.disconnect();
    denoiser?.disconnect();
    source.disconnect();
    gate = buildGate(lib, context, threshold);
    const head = denoiser ?? gate ?? gain;
    source.connect(head);
    if (denoiser !== null) {
      denoiser.connect(gate ?? gain);
    }
    gate?.connect(gain);
  };
  wire();

  return {
    stream: destination.stream,
    enhanced: denoiser !== null,
    setSettings(next) {
      gain.gain.setTargetAtTime(next.inputVolume, context.currentTime, 0.02);
      if (next.noiseGateThreshold !== threshold) {
        threshold = next.noiseGateThreshold;
        wire();
      }
    },
    stop() {
      gate?.disconnect();
      denoiser?.destroy();
      denoiser?.disconnect();
      source.disconnect();
      gain.disconnect();
      for (const track of stream.getTracks()) {
        track.stop();
      }
      void context.close().catch(() => undefined);
    },
  };
}

/**
 * Opens the microphone and builds its processing chain. The learned denoiser is
 * only requested (and the browser's own suppression only switched off) after it
 * has proved it can run here.
 */
export async function openMicPipeline(settings: VoiceDeviceSettings): Promise<MicPipeline> {
  const enhanced = settings.enhancedNoiseSuppression && (await enhancedNoiseSuppressionAvailable());
  const raw = await acquireUserMedia({ settings, withVideo: false, enhanced });
  const pipeline = await createMicPipeline(raw, settings, enhanced);
  if (enhanced && !pipeline.enhanced) {
    // The denoiser failed to start after the browser's own suppression was
    // switched off for it. Reopen the microphone with that suppression back on
    // rather than send a raw, unfiltered voice.
    pipeline.stop();
    const plain = await acquireUserMedia({ settings, withVideo: false, enhanced: false });
    return await createMicPipeline(plain, settings, false);
  }
  return pipeline;
}
