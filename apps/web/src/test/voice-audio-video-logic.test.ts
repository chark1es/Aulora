import { DEFAULT_VOICE_SETTINGS } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { smoothMask } from "../lib/voice/effects/segmenter";
import { gateOpenThresholdDb, micProcessingKey } from "../lib/voice/mic-pipeline";
import { screenBitrateFor } from "../lib/voice/peer-mesh";

describe("gateOpenThresholdDb", () => {
  it("has no gate at zero", () => {
    expect(gateOpenThresholdDb(0)).toBeNull();
    expect(gateOpenThresholdDb(-1)).toBeNull();
  });

  it("opens higher as the slider rises, within a sane range", () => {
    const low = gateOpenThresholdDb(0.1);
    const high = gateOpenThresholdDb(0.5);
    expect(low).not.toBeNull();
    expect(high).not.toBeNull();
    expect(high as number).toBeGreaterThan(low as number);
    expect(low as number).toBeLessThan(-60);
    expect(gateOpenThresholdDb(1)).toBe(-30);
  });

  it("never goes above the top of the range", () => {
    expect(gateOpenThresholdDb(5)).toBe(-30);
  });
});

describe("micProcessingKey", () => {
  it("changes whenever a flag that needs a fresh microphone capture changes", () => {
    const base = micProcessingKey(DEFAULT_VOICE_SETTINGS);
    expect(micProcessingKey({ ...DEFAULT_VOICE_SETTINGS, echoCancellation: false })).not.toBe(base);
    expect(micProcessingKey({ ...DEFAULT_VOICE_SETTINGS, noiseSuppression: false })).not.toBe(base);
    expect(micProcessingKey({ ...DEFAULT_VOICE_SETTINGS, autoGainControl: false })).not.toBe(base);
    expect(
      micProcessingKey({ ...DEFAULT_VOICE_SETTINGS, enhancedNoiseSuppression: true }),
    ).not.toBe(base);
  });

  it("ignores settings that apply without reopening the microphone", () => {
    const base = micProcessingKey(DEFAULT_VOICE_SETTINGS);
    expect(micProcessingKey({ ...DEFAULT_VOICE_SETTINGS, inputVolume: 1.7 })).toBe(base);
    expect(micProcessingKey({ ...DEFAULT_VOICE_SETTINGS, noiseGateThreshold: 0.4 })).toBe(base);
  });
});

describe("smoothMask", () => {
  it("moves each value part of the way to the new one, in place", () => {
    const previous = Uint8Array.from([0, 100, 255]);
    const result = smoothMask(previous, Uint8Array.from([100, 100, 0]), 0.5);
    expect(result).toBe(previous);
    expect(Array.from(previous)).toEqual([50, 100, 128]);
  });

  it("takes the new mask outright at full weight and ignores it at zero", () => {
    expect(Array.from(smoothMask(Uint8Array.from([10, 20]), Uint8Array.from([200, 0]), 1))).toEqual(
      [200, 0],
    );
    expect(Array.from(smoothMask(Uint8Array.from([10, 20]), Uint8Array.from([200, 0]), 0))).toEqual(
      [10, 20],
    );
  });

  it("keeps the old value where the new mask is shorter", () => {
    expect(Array.from(smoothMask(Uint8Array.from([40, 80]), Uint8Array.from([0]), 1))).toEqual([
      0, 80,
    ]);
  });
});

describe("the mesh upload budget stays consistent with the stream profile", () => {
  it("never asks for more than one viewer's cap", () => {
    expect(screenBitrateFor({ maxBitrate: 3_500_000, frameRate: 30 }, 1)).toBe(3_500_000);
  });
});
