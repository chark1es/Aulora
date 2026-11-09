import { describe, expect, it } from "vitest";
import {
  Downsampler,
  encodePcm16,
  FRAME_SAMPLES,
  floatToPcm16,
  mixToMono,
  PcmCapture,
  PcmFramer,
} from "./pcm";

function sine(frequency: number, rate: number, seconds: number, amplitude = 0.5): Float32Array {
  const samples = new Float32Array(Math.round(rate * seconds));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / rate);
  }
  return samples;
}

function int16(buffer: ArrayBuffer): Int16Array {
  const view = new DataView(buffer);
  const out = new Int16Array(buffer.byteLength / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = view.getInt16(index * 2, true);
  }
  return out;
}

describe("floatToPcm16", () => {
  it("scales, rounds and clamps to the signed 16-bit range", () => {
    expect(floatToPcm16(0)).toBe(0);
    expect(floatToPcm16(1)).toBe(32767);
    expect(floatToPcm16(-1)).toBe(-32768);
    expect(floatToPcm16(0.5)).toBe(16384);
    expect(floatToPcm16(2.5)).toBe(32767);
    expect(floatToPcm16(-9)).toBe(-32768);
  });
});

describe("encodePcm16", () => {
  it("writes little-endian even-length bytes", () => {
    const buffer = encodePcm16([1, -1, 0]);
    expect(buffer.byteLength).toBe(6);
    expect([...new Uint8Array(buffer)]).toEqual([0xff, 0x7f, 0x00, 0x80, 0x00, 0x00]);
  });
});

describe("mixToMono", () => {
  it("averages channels and passes a mono channel through", () => {
    const mono = Float32Array.of(0.2, 0.4);
    expect(mixToMono([mono])).toBe(mono);
    const mixed = mixToMono([Float32Array.of(1, 0), Float32Array.of(0, 1)]);
    expect([...mixed]).toEqual([0.5, 0.5]);
    expect(mixToMono([]).length).toBe(0);
  });
});

describe("Downsampler", () => {
  it("converts 48 kHz to 16 kHz at exactly one third the length", () => {
    const out = new Downsampler(48_000).process(sine(440, 48_000, 1));
    expect(out.length).toBe(16_000);
  });

  it("preserves a speech-band tone's amplitude and frequency", () => {
    const out = new Downsampler(48_000).process(sine(440, 48_000, 1, 0.5));
    let peak = 0;
    let crossings = 0;
    for (let index = 1; index < out.length; index += 1) {
      peak = Math.max(peak, Math.abs(out[index] ?? 0));
      if ((out[index - 1] ?? 0) < 0 !== (out[index] ?? 0) < 0) {
        crossings += 1;
      }
    }
    expect(peak).toBeGreaterThan(0.45);
    expect(peak).toBeLessThanOrEqual(0.5);
    // 440 Hz makes about 880 zero crossings per second.
    expect(Math.abs(crossings - 880)).toBeLessThanOrEqual(4);
  });

  it("handles a non-integer ratio (44.1 kHz) with the right output count", () => {
    const out = new Downsampler(44_100).process(sine(300, 44_100, 1));
    expect(Math.abs(out.length - 16_000)).toBeLessThanOrEqual(1);
  });

  it("is chunk-boundary independent", () => {
    const input = sine(440, 44_100, 0.5);
    const whole = new Downsampler(44_100).process(input);
    const split = new Downsampler(44_100);
    const parts: number[] = [];
    // 128-sample render quanta, as an AudioWorklet delivers them.
    for (let start = 0; start < input.length; start += 128) {
      parts.push(...split.process(input.subarray(start, start + 128)));
    }
    expect(parts.length).toBe(whole.length);
    for (let index = 0; index < whole.length; index += 1) {
      expect(parts[index]).toBeCloseTo(whole[index] ?? 0, 5);
    }
  });

  it("interpolates a lower input rate up to 16 kHz", () => {
    const out = new Downsampler(8_000).process(sine(200, 8_000, 1));
    expect(Math.abs(out.length - 16_000)).toBeLessThanOrEqual(2);
  });

  it("passes silence through as silence and rejects a bad rate", () => {
    const out = new Downsampler(48_000).process(new Float32Array(4_800));
    expect(out.every((sample) => sample === 0)).toBe(true);
    expect(() => new Downsampler(0)).toThrow(RangeError);
  });
});

describe("PcmFramer", () => {
  it("emits exact 100 ms frames of 3,200 bytes and keeps the remainder", () => {
    const framer = new PcmFramer();
    const frames = framer.push(new Float32Array(FRAME_SAMPLES * 2 + 100));
    expect(frames).toHaveLength(2);
    expect(frames.every((frame) => frame.byteLength === 3_200)).toBe(true);
    const tail = framer.flush();
    expect(tail?.byteLength).toBe(200);
    expect(framer.flush()).toBeNull();
  });

  it("never emits an odd or oversized frame", () => {
    const framer = new PcmFramer(8_192);
    for (const frame of framer.push(new Float32Array(20_000))) {
      expect(frame.byteLength % 2).toBe(0);
      expect(frame.byteLength).toBeLessThanOrEqual(16_384);
    }
    expect(() => new PcmFramer(8_193)).toThrow(RangeError);
    expect(() => new PcmFramer(0)).toThrow(RangeError);
  });

  it("drops buffered samples on reset", () => {
    const framer = new PcmFramer();
    framer.push(new Float32Array(500));
    framer.reset();
    expect(framer.flush()).toBeNull();
  });
});

describe("PcmCapture", () => {
  it("turns 48 kHz render quanta into wire frames of the right values", () => {
    const capture = new PcmCapture(48_000);
    const source = sine(440, 48_000, 0.35, 0.8);
    const frames: ArrayBuffer[] = [];
    for (let start = 0; start < source.length; start += 128) {
      frames.push(...capture.push([source.subarray(start, start + 128)]));
    }
    // 0.35 s at 16 kHz is 5,600 samples: three full 100 ms frames, remainder buffered.
    expect(frames).toHaveLength(3);
    for (const frame of frames) {
      expect(frame.byteLength).toBe(3_200);
    }
    const peak = Math.max(...[...int16(frames[1] as ArrayBuffer)].map(Math.abs));
    expect(peak).toBeGreaterThan(0.7 * 32_767);
    expect(peak).toBeLessThanOrEqual(0.8 * 32_767 + 1);
  });
});
