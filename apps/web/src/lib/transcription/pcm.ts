import { TRANSCRIBER_MAX_FRAME_BYTES, TRANSCRIBER_SAMPLE_RATE_HZ } from "@aulora/core";

/**
 * Pure audio conversion for the transcriber's wire format: 16 kHz mono signed
 * 16-bit little-endian PCM in even-length frames of at most 16 KiB. Kept free of
 * browser globals so the same code runs inside the capture AudioWorklet and in
 * unit tests.
 */

/** A frame is 100 ms of audio: 1,600 samples, 3,200 bytes. */
export const FRAME_SAMPLES = TRANSCRIBER_SAMPLE_RATE_HZ / 10;

const BYTES_PER_SAMPLE = 2;

/** Largest number of samples that fits one wire frame. */
export const MAX_FRAME_SAMPLES = Math.floor(TRANSCRIBER_MAX_FRAME_BYTES / BYTES_PER_SAMPLE);

/** Clamps a float sample to [-1, 1] and scales it to a signed 16-bit integer. */
export function floatToPcm16(sample: number): number {
  const clamped = sample > 1 ? 1 : sample < -1 ? -1 : sample;
  return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
}

/** Serialises samples as little-endian 16-bit PCM, whatever the platform's endianness. */
export function encodePcm16(samples: ArrayLike<number>): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * BYTES_PER_SAMPLE);
  const view = new DataView(buffer);
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(index * BYTES_PER_SAMPLE, floatToPcm16(samples[index] ?? 0), true);
  }
  return buffer;
}

/** Averages the channels of one render quantum into a mono signal. */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0];
  if (first === undefined) {
    return new Float32Array(0);
  }
  if (channels.length === 1) {
    return first;
  }
  const mono = new Float32Array(first.length);
  for (const channel of channels) {
    const length = Math.min(mono.length, channel.length);
    for (let index = 0; index < length; index += 1) {
      mono[index] = (mono[index] ?? 0) + (channel[index] ?? 0);
    }
  }
  const scale = 1 / channels.length;
  for (let index = 0; index < mono.length; index += 1) {
    mono[index] = (mono[index] ?? 0) * scale;
  }
  return mono;
}

/**
 * Streaming sample-rate converter to 16 kHz. Down-conversion averages the input
 * samples that fall inside each output sample (exact area averaging, which also
 * acts as a mild low-pass); a lower input rate is linearly interpolated. State
 * carries across calls, so chunk boundaries never produce a click or drift.
 */
export class Downsampler {
  private readonly ratio: number;
  private acc = 0;
  private phase = 0;
  private lastInput = 0;
  private position = 0;

  constructor(inputRate: number, outputRate: number = TRANSCRIBER_SAMPLE_RATE_HZ) {
    if (!Number.isFinite(inputRate) || inputRate <= 0) {
      throw new RangeError("The input sample rate must be a positive number");
    }
    this.ratio = inputRate / outputRate;
  }

  /** Converts one chunk; the result may be empty for a very short chunk. */
  process(input: Float32Array): Float32Array {
    return this.ratio <= 1 ? this.interpolate(input) : this.average(input);
  }

  private average(input: Float32Array): Float32Array {
    const out = new Float32Array(Math.ceil(input.length / this.ratio) + 1);
    let count = 0;
    for (const x of input) {
      const remaining = this.ratio - this.phase;
      if (remaining >= 1 - 1e-9) {
        this.acc += x;
        this.phase += 1;
        if (this.phase >= this.ratio - 1e-9) {
          out[count] = this.acc / this.ratio;
          count += 1;
          this.acc = 0;
          this.phase = 0;
        }
      } else {
        // This input sample straddles the boundary between two output samples.
        this.acc += x * remaining;
        out[count] = this.acc / this.ratio;
        count += 1;
        this.acc = x * (1 - remaining);
        this.phase = 1 - remaining;
      }
    }
    return out.slice(0, count);
  }

  private interpolate(input: Float32Array): Float32Array {
    const length = input.length;
    if (length === 0) {
      return new Float32Array(0);
    }
    const out: number[] = [];
    // `position` indexes the virtual array [lastInput, ...input] shifted by one:
    // -1 is the previous chunk's last sample, so chunk edges interpolate cleanly.
    const at = (index: number): number => (index < 0 ? this.lastInput : (input[index] ?? 0));
    while (this.position <= length - 1) {
      const base = Math.floor(this.position);
      const fraction = this.position - base;
      const left = at(base);
      const right = fraction === 0 ? left : at(base + 1);
      out.push(left + (right - left) * fraction);
      this.position += this.ratio;
    }
    this.position -= length;
    this.lastInput = input[length - 1] ?? this.lastInput;
    return Float32Array.from(out);
  }
}

/**
 * Collects 16-bit samples into fixed-size wire frames. `flush` hands back the
 * remaining partial frame (even length by construction).
 */
export class PcmFramer {
  private readonly buffer: Float32Array;
  private filled = 0;

  constructor(private readonly frameSamples: number = FRAME_SAMPLES) {
    if (!Number.isInteger(frameSamples) || frameSamples <= 0 || frameSamples > MAX_FRAME_SAMPLES) {
      throw new RangeError("A frame must hold between 1 and 8,192 samples");
    }
    this.buffer = new Float32Array(frameSamples);
  }

  push(samples: Float32Array): ArrayBuffer[] {
    const frames: ArrayBuffer[] = [];
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(this.frameSamples - this.filled, samples.length - offset);
      this.buffer.set(samples.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === this.frameSamples) {
        frames.push(encodePcm16(this.buffer));
        this.filled = 0;
      }
    }
    return frames;
  }

  flush(): ArrayBuffer | null {
    if (this.filled === 0) {
      return null;
    }
    const frame = encodePcm16(this.buffer.subarray(0, this.filled));
    this.filled = 0;
    return frame;
  }

  /** Drops buffered samples without emitting them (a closed gate keeps nothing). */
  reset(): void {
    this.filled = 0;
  }
}

/** One capture chain: mono mix, convert to 16 kHz, cut into frames. */
export class PcmCapture {
  private readonly downsampler: Downsampler;
  private readonly framer = new PcmFramer();

  constructor(inputRate: number) {
    this.downsampler = new Downsampler(inputRate);
  }

  push(channels: readonly Float32Array[]): ArrayBuffer[] {
    return this.framer.push(this.downsampler.process(mixToMono(channels)));
  }

  reset(): void {
    this.framer.reset();
  }
}
