import { describe, expect, it, vi } from "vitest";

const CONTEXT_RATE = 48000;
const BLOCK_SIZE = 128;
/** Ring buffer cap implemented by the worklet: 300 ms at the context rate. */
const CAPACITY = Math.ceil(CONTEXT_RATE * 0.3);

interface WorkletPort {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: (message: unknown) => void;
}

interface WorkletInstance {
  port: WorkletPort;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

interface WorkletModule {
  PcmPlaybackProcessor: new () => WorkletInstance;
}

class StubAudioWorkletProcessor {
  port: WorkletPort = { onmessage: null, postMessage: vi.fn() };
}

const audioGlobals = globalThis as unknown as {
  AudioWorkletProcessor: typeof StubAudioWorkletProcessor;
  sampleRate: number;
};

// The worklet subclasses `AudioWorkletProcessor` and reads the `sampleRate`
// global, neither of which exists under jsdom, so stub both before importing.
// The dynamic import is deliberate: a static import would evaluate the module
// before the stubs exist, and this file intentionally exercises that boundary.
audioGlobals.AudioWorkletProcessor = StubAudioWorkletProcessor;
audioGlobals.sampleRate = CONTEXT_RATE;

const { PcmPlaybackProcessor } = (await import(
  // @ts-expect-error The worklet is plain JS served from `public/`, so it ships
  // no declarations and is deliberately excluded from the TypeScript program.
  "../../public/worklets/pcm-playback.js"
)) as unknown as WorkletModule;

function sample(data: Float32Array, index: number): number {
  return data[index] ?? 0;
}

function concat(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

interface Rendered {
  left: Float32Array;
  right: Float32Array;
}

/** Drives `process` for `blocks` quanta with a stereo output pair. */
function render(processor: WorkletInstance, blocks: number): Rendered {
  const leftChunks: Float32Array[] = [];
  const rightChunks: Float32Array[] = [];
  for (let block = 0; block < blocks; block += 1) {
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    const outputs: Float32Array[][] = [[left, right]];
    expect(processor.process([], outputs)).toBe(true);
    leftChunks.push(left);
    rightChunks.push(right);
  }
  return { left: concat(leftChunks), right: concat(rightChunks) };
}

/** MessagePort delivers worklet messages wrapped in `{ data }`. */
function send(processor: WorkletInstance, message: unknown): void {
  const handler = processor.port.onmessage;
  if (handler === null) {
    throw new Error("processor.port.onmessage was not wired");
  }
  handler({ data: message });
}

function interleave(left: Float32Array, right: Float32Array): Float32Array {
  const pcm = new Float32Array(left.length * 2);
  for (let frame = 0; frame < left.length; frame += 1) {
    pcm[frame * 2] = sample(left, frame);
    pcm[frame * 2 + 1] = sample(right, frame);
  }
  return pcm;
}

function constantChunk(frames: number, channels: number, value: number): Float32Array {
  return new Float32Array(frames * channels).fill(value);
}

describe("PcmPlaybackProcessor", () => {
  it("renders silence before any data arrives", () => {
    const processor = new PcmPlaybackProcessor();
    const rendered = render(processor, 2);
    expect(rendered.left).toHaveLength(BLOCK_SIZE * 2);
    expect(rendered.left.every((value) => value === 0)).toBe(true);
    expect(rendered.right.every((value) => value === 0)).toBe(true);
  });

  it("renders a 20 ms stereo chunk at the context rate in order", () => {
    const processor = new PcmPlaybackProcessor();
    const frames = Math.round(CONTEXT_RATE * 0.02);
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame += 1) {
      const value = (frame / (frames - 1)) * 2 - 1;
      left[frame] = value;
      right[frame] = -value;
    }
    send(processor, { type: "header", sampleRate: CONTEXT_RATE, channels: 2 });
    send(processor, { type: "pcm", pcm: interleave(left, right) });

    // The chunk spans 7.5 quanta; a ninth block proves the tail is silence.
    const rendered = render(processor, 9);
    for (let frame = 0; frame < frames; frame += 1) {
      expect(sample(rendered.left, frame)).toBeCloseTo(sample(left, frame), 3);
      expect(sample(rendered.right, frame)).toBeCloseTo(sample(right, frame), 3);
    }
    for (let frame = frames; frame < rendered.left.length; frame += 1) {
      expect(sample(rendered.left, frame)).toBe(0);
      expect(sample(rendered.right, frame)).toBe(0);
    }
  });

  it("duplicates a mono source into both output channels", () => {
    const processor = new PcmPlaybackProcessor();
    const frames = 960;
    const mono = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame += 1) {
      mono[frame] = frame / frames;
    }
    send(processor, { type: "header", sampleRate: CONTEXT_RATE, channels: 1 });
    send(processor, { type: "pcm", pcm: mono });

    const rendered = render(processor, 8);
    for (let frame = 0; frame < frames; frame += 1) {
      expect(sample(rendered.left, frame)).toBeCloseTo(sample(mono, frame), 3);
      expect(sample(rendered.right, frame)).toBe(sample(rendered.left, frame));
    }
  });

  it("resamples a 24 kHz source to the context rate", () => {
    const processor = new PcmPlaybackProcessor();
    const chunks = 10;
    // 10 x 640 source frames become ~12800 context frames: under the 300 ms cap.
    const sourceFrames = 640;
    send(processor, { type: "header", sampleRate: 24000, channels: 1 });
    const chunk = constantChunk(sourceFrames, 1, 0.25);
    for (let index = 0; index < chunks; index += 1) {
      send(processor, { type: "pcm", pcm: chunk });
    }

    const rendered = render(processor, 102);
    let produced = 0;
    for (let frame = 0; frame < rendered.left.length; frame += 1) {
      const value = sample(rendered.left, frame);
      if (Math.abs(value - 0.25) < 1e-4) {
        produced += 1;
      } else {
        expect(value).toBe(0);
      }
    }
    // 2:1 upsampling, minus the one-frame interpolation lookahead.
    expect(Math.abs(produced - chunks * sourceFrames * 2)).toBeLessThanOrEqual(1);
  });

  it("drops the oldest frames when the buffer overruns", () => {
    const processor = new PcmPlaybackProcessor();
    const frames = 960;
    send(processor, { type: "header", sampleRate: CONTEXT_RATE, channels: 2 });
    const hot = constantChunk(frames, 2, 0.9);
    for (let index = 0; index < 199; index += 1) {
      send(processor, { type: "pcm", pcm: hot });
    }
    send(processor, { type: "pcm", pcm: constantChunk(frames, 2, 0.1) });

    const rendered = render(processor, Math.ceil(CAPACITY / BLOCK_SIZE) + 4);
    const left = rendered.left;
    let audible = 0;
    for (let frame = 0; frame < left.length; frame += 1) {
      if (sample(left, frame) !== 0) {
        audible += 1;
      }
    }
    // Latency is capped at 300 ms of frames, not the 200 chunks that were fed.
    expect(audible).toBe(CAPACITY);
    // The oldest frames were dropped: playback starts inside the retained window.
    expect(sample(left, 0)).toBeCloseTo(0.9, 6);
    // The newest chunk survives at the tail of the buffer.
    expect(sample(left, CAPACITY - frames)).toBeCloseTo(0.1, 6);
    expect(sample(left, CAPACITY - 1)).toBeCloseTo(0.1, 6);
    for (let frame = CAPACITY; frame < left.length; frame += 1) {
      expect(sample(left, frame)).toBe(0);
    }
  });

  it("flush drops buffered audio", () => {
    const processor = new PcmPlaybackProcessor();
    send(processor, { type: "header", sampleRate: CONTEXT_RATE, channels: 1 });
    send(processor, { type: "pcm", pcm: constantChunk(960, 1, 0.5) });
    send(processor, { type: "flush" });

    const rendered = render(processor, 2);
    expect(rendered.left.every((value) => value === 0)).toBe(true);
    expect(rendered.right.every((value) => value === 0)).toBe(true);

    // The interpolation seam is cleared too: the next chunk starts on its own
    // first frame rather than on a stale previous one.
    send(processor, { type: "pcm", pcm: constantChunk(BLOCK_SIZE, 1, 0.25) });
    const after = render(processor, 1);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      expect(sample(after.left, frame)).toBeCloseTo(0.25, 5);
    }
  });

  it("wires incoming messages through port.onmessage", () => {
    const processor = new PcmPlaybackProcessor();
    expect(typeof processor.port.onmessage).toBe("function");
    const handler = processor.port.onmessage;
    if (handler === null) {
      throw new Error("processor.port.onmessage was not wired");
    }

    handler({ data: { type: "header", sampleRate: CONTEXT_RATE, channels: 1 } });
    handler({ data: { type: "pcm", pcm: constantChunk(BLOCK_SIZE, 1, 0.5) } });
    const rendered = render(processor, 1);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      expect(sample(rendered.left, frame)).toBeCloseTo(0.5, 5);
    }

    handler({ data: { type: "flush" } });
    const flushed = render(processor, 1);
    expect(flushed.left.every((value) => value === 0)).toBe(true);
  });
});
