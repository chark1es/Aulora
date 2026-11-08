import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AudioStreamHeader } from "./desktop-display";
import { openSystemAudioStream, workletUrl } from "./system-audio";

const HEADER: AudioStreamHeader = {
  sampleRate: 48_000,
  channels: 2,
  format: "f32",
  backend: "wasapi-exclude-process",
  warnings: [],
};

interface FakeNode {
  readonly port: { postMessage: Mock };
  readonly connect: Mock;
  readonly disconnect: Mock;
}

interface FakeSink {
  readonly stream: { getAudioTracks: () => MediaStreamTrack[] };
  readonly disconnect: Mock;
}

/** The parts of `AudioContext` this module touches, with real behaviour. */
interface FakeContext {
  state: AudioContextState;
  readonly audioWorklet: { addModule: Mock };
  readonly createMediaStreamDestination: () => FakeSink;
  readonly close: Mock;
  readonly resume: Mock;
}

/** jsdom has no Web Audio, so the fake is handed over at the seam. */
function asAudioContext(fake: FakeContext): AudioContext {
  return fake as unknown as AudioContext;
}

let posted: unknown[] = [];
let nodes: FakeNode[] = [];
let sink: FakeSink;
let track: MediaStreamTrack & { stop: Mock };
let context: FakeContext;

function fakeEnvironment(): void {
  posted = [];
  nodes = [];
  track = { kind: "audio", contentHint: "", stop: vi.fn() } as unknown as MediaStreamTrack & {
    stop: Mock;
  };
  sink = { stream: { getAudioTracks: () => [track] }, disconnect: vi.fn() };
  context = {
    state: "running",
    audioWorklet: { addModule: vi.fn(async () => {}) },
    createMediaStreamDestination: () => sink,
    close: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
  };

  class FakeAudioWorkletNode implements FakeNode {
    readonly port = {
      postMessage: vi.fn((message: unknown) => {
        posted.push(message);
      }),
    };
    readonly connect = vi.fn();
    readonly disconnect = vi.fn();
    constructor() {
      nodes.push(this);
    }
  }
  (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = FakeAudioWorkletNode;
}

beforeEach(() => {
  fakeEnvironment();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "AudioWorkletNode");
});

describe("workletUrl", () => {
  it("serves the bundled worklet from the app origin", () => {
    expect(workletUrl("/")).toBe("/worklets/pcm-playback.js");
    // A sub-path deployment keeps working, and the CSP still sees 'self'.
    expect(workletUrl("/app/")).toBe("/app/worklets/pcm-playback.js");
  });
});

describe("openSystemAudioStream", () => {
  it("announces the sample rate before forwarding samples", async () => {
    const chunks = [new Float32Array([0.1, -0.1]), new Float32Array([0.2, -0.2])];
    const stream = await openSystemAudioStream("screen:1", {
      createContext: () => asAudioContext(context),
      loadWorklet: async () => {},
      stopCapture: async () => {},
      // Chunks arrive while the command is still returning, which is the race
      // the header ordering has to survive.
      startCapture: async (onPcm) => {
        for (const chunk of chunks) {
          onPcm(chunk);
        }
        return HEADER;
      },
    });

    expect(stream.track).toBe(track);
    expect(track.contentHint).toBe("music");
    expect(posted).toEqual([
      { type: "header", sampleRate: 48_000, channels: 2 },
      { type: "pcm", pcm: chunks[0] },
      { type: "pcm", pcm: chunks[1] },
    ]);
    stream.stop();
  });

  it("loads the bundled worklet module", async () => {
    const loadModule = vi.fn(async () => {});
    const stream = await openSystemAudioStream("screen:1", {
      createContext: () => asAudioContext(context),
      loadWorklet: async (audioContext) => {
        await audioContext.audioWorklet.addModule(workletUrl());
        loadModule();
      },
      startCapture: async () => HEADER,
      stopCapture: async () => {},
    });

    expect(context.audioWorklet.addModule).toHaveBeenCalledWith("/worklets/pcm-playback.js");
    expect(loadModule).toHaveBeenCalledTimes(1);
    stream.stop();
  });

  it("resumes a suspended context before playing", async () => {
    context.state = "suspended";
    const stream = await openSystemAudioStream("screen:1", {
      createContext: () => asAudioContext(context),
      loadWorklet: async () => {},
      startCapture: async () => HEADER,
      stopCapture: async () => {},
    });

    expect(context.resume).toHaveBeenCalledTimes(1);
    stream.stop();
  });

  it("stops the shell capture, the graph, the track and the context once", async () => {
    const stopCapture = vi.fn(async () => {});
    const stream = await openSystemAudioStream("screen:1", {
      createContext: () => asAudioContext(context),
      loadWorklet: async () => {},
      startCapture: async () => HEADER,
      stopCapture,
    });

    stream.stop();
    stream.stop();

    expect(nodes[0]?.disconnect).toHaveBeenCalledTimes(1);
    expect(sink.disconnect).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(stopCapture).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
    // The worklet is told to drop what it buffered before it goes away.
    expect(posted.at(-1)).toEqual({ type: "flush" });
  });

  it("tears everything down when the backend refuses", async () => {
    await expect(
      openSystemAudioStream("screen:1", {
        createContext: () => asAudioContext(context),
        loadWorklet: async () => {},
        startCapture: async () => {
          throw new Error("This Wayland session has no monitor source.");
        },
        stopCapture: async () => {},
      }),
    ).rejects.toThrow("no monitor source");

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("fails clearly when the pipeline cannot make a track", async () => {
    const empty: FakeContext = {
      ...context,
      createMediaStreamDestination: () => ({
        stream: { getAudioTracks: () => [] },
        disconnect: vi.fn(),
      }),
    };

    await expect(
      openSystemAudioStream("screen:1", {
        createContext: () => asAudioContext(empty),
        loadWorklet: async () => {},
        startCapture: async () => HEADER,
        stopCapture: async () => {},
      }),
    ).rejects.toThrow("did not produce a track");
  });
});
