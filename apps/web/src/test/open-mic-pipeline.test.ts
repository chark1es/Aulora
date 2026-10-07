import { DEFAULT_VOICE_SETTINGS } from "@aulora/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const media = vi.hoisted(() => ({ acquireUserMedia: vi.fn() }));
vi.mock("../lib/voice/media", () => media);

const lib = vi.hoisted(() => ({
  failRnnoiseWorklet: false,
  failBinary: false,
}));
vi.mock("@sapphi-red/web-noise-suppressor", () => ({
  loadRnnoise: async () => {
    if (lib.failBinary) {
      throw new Error("wasm blocked");
    }
    return new ArrayBuffer(8);
  },
  RnnoiseWorkletNode: class {
    connect = vi.fn();
    disconnect = vi.fn();
    destroy = vi.fn();
  },
  NoiseGateWorkletNode: class {
    connect = vi.fn();
    disconnect = vi.fn();
  },
}));
vi.mock("@sapphi-red/web-noise-suppressor/noiseGateWorklet.js?url", () => ({ default: "gate.js" }));
vi.mock("@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url", () => ({ default: "rnn.js" }));
vi.mock("@sapphi-red/web-noise-suppressor/rnnoise.wasm?url", () => ({ default: "a.wasm" }));
vi.mock("@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url", () => ({ default: "b.wasm" }));

class FakeContext {
  currentTime = 0;
  audioWorklet = {
    addModule: async (url: string) => {
      if (url === "rnn.js" && lib.failRnnoiseWorklet) {
        throw new Error("worklet blocked");
      }
    },
  };
  createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  createGain = () => ({
    gain: { value: 1, setTargetAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  });
  createMediaStreamDestination = () => ({ stream: { id: "processed", getTracks: () => [] } });
  resume = async () => undefined;
  close = async () => undefined;
}

function rawStream(id: string) {
  return { id, getAudioTracks: () => [{}], getTracks: () => [{ stop: vi.fn() }] };
}

beforeEach(() => {
  vi.resetModules();
  media.acquireUserMedia.mockReset();
  lib.failRnnoiseWorklet = false;
  lib.failBinary = false;
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("AudioWorkletNode", class {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function open(enhanced: boolean) {
  const { openMicPipeline } = await import("../lib/voice/mic-pipeline");
  return await openMicPipeline({ ...DEFAULT_VOICE_SETTINGS, enhancedNoiseSuppression: enhanced });
}

describe("openMicPipeline", () => {
  it("opens the microphone once, with the browser's suppression off, when the denoiser runs", async () => {
    media.acquireUserMedia.mockResolvedValue(rawStream("raw"));
    const pipeline = await open(true);
    expect(pipeline.enhanced).toBe(true);
    expect(media.acquireUserMedia).toHaveBeenCalledTimes(1);
    expect(media.acquireUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ enhanced: true }),
    );
  });

  it("keeps the browser's suppression on when enhanced is not asked for", async () => {
    media.acquireUserMedia.mockResolvedValue(rawStream("raw"));
    const pipeline = await open(false);
    expect(pipeline.enhanced).toBe(false);
    expect(media.acquireUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ enhanced: false }),
    );
  });

  it("never switches the browser's suppression off when the denoiser model cannot load", async () => {
    lib.failBinary = true;
    media.acquireUserMedia.mockResolvedValue(rawStream("raw"));
    const pipeline = await open(true);
    expect(pipeline.enhanced).toBe(false);
    expect(media.acquireUserMedia).toHaveBeenCalledTimes(1);
    expect(media.acquireUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ enhanced: false }),
    );
  });

  it("reopens the microphone with the browser's suppression back on if the denoiser fails to start", async () => {
    lib.failRnnoiseWorklet = true;
    media.acquireUserMedia.mockImplementation(async (options: { enhanced: boolean }) =>
      rawStream(options.enhanced ? "no-browser-suppression" : "with-browser-suppression"),
    );
    const pipeline = await open(true);
    expect(pipeline.enhanced).toBe(false);
    expect(media.acquireUserMedia).toHaveBeenCalledTimes(2);
    expect(media.acquireUserMedia).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ enhanced: true }),
    );
    expect(media.acquireUserMedia).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ enhanced: false }),
    );
  });
});
