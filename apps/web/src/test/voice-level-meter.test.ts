import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLevelMeter, resumeLevelMeterContext } from "../lib/voice/media";

/**
 * A minimal `AudioContext` stand-in. Only what the level meter touches, plus the
 * counters that prove the context is shared and reference counted.
 */
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static resumes = 0;
  closed = false;
  currentTime = 0;
  destination = {} as AudioDestinationNode;

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createMediaStreamSource(): MediaStreamAudioSourceNode {
    return { connect: vi.fn(), disconnect: vi.fn() } as unknown as MediaStreamAudioSourceNode;
  }

  createAnalyser(): AnalyserNode {
    return {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 4,
      connect: vi.fn(),
      disconnect: vi.fn(),
      getByteFrequencyData: (data: Uint8Array) => {
        data.fill(0);
      },
    } as unknown as AnalyserNode;
  }

  resume(): Promise<void> {
    FakeAudioContext.resumes += 1;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

const stream = { getAudioTracks: () => [{ kind: "audio" }] } as unknown as MediaStream;

describe("shared level meter context", () => {
  const globals = globalThis as { AudioContext?: typeof AudioContext };
  const saved = globals.AudioContext;

  beforeEach(() => {
    FakeAudioContext.instances = [];
    FakeAudioContext.resumes = 0;
    globals.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
  });

  afterEach(() => {
    if (saved === undefined) {
      delete globals.AudioContext;
    } else {
      globals.AudioContext = saved;
    }
  });

  it("uses one context for every stream in the call", () => {
    const first = createLevelMeter(stream, () => {});
    const second = createLevelMeter(stream, () => {});
    expect(FakeAudioContext.instances).toHaveLength(1);
    first();
    second();
  });

  it("closes the context only when the last meter stops", () => {
    const first = createLevelMeter(stream, () => {});
    const second = createLevelMeter(stream, () => {});
    const context = FakeAudioContext.instances[0];
    first();
    expect(context?.closed).toBe(false);
    second();
    expect(context?.closed).toBe(true);
  });

  it("recreates a context for the next call", () => {
    createLevelMeter(stream, () => {})();
    createLevelMeter(stream, () => {})();
    expect(FakeAudioContext.instances).toHaveLength(2);
  });

  it("resumes the shared context from a gesture", () => {
    const stop = createLevelMeter(stream, () => {});
    const before = FakeAudioContext.resumes;
    resumeLevelMeterContext();
    expect(FakeAudioContext.resumes).toBe(before + 1);
    stop();
  });

  it("degrades to a no-op meter without WebAudio", () => {
    delete globals.AudioContext;
    const stop = createLevelMeter(stream, () => {});
    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(() => stop()).not.toThrow();
  });
});
