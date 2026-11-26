import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type PipSurface, usePipMedia } from "../components/voice/use-pip-media";

const mocks = vi.hoisted(() => ({
  onTrack: null as ((track: MediaStreamTrack) => void) | null,
}));

vi.mock("../lib/desktop", () => ({
  emitDesktopEventTo: vi.fn(async () => undefined),
  listenDesktopEvent: vi.fn(async () => () => {}),
}));
vi.mock("../lib/voice/pip-frames", () => ({
  registerPipFrames: () => () => {},
  createPipFramePainter: () => ({ draw: vi.fn() }),
}));
vi.mock("../lib/voice/pip-loopback", () => ({
  loopbackSupported: () => true,
  parseLoopbackSignal: () => null,
  createPipReceiver: (options: { onTrack: (track: MediaStreamTrack) => void }) => {
    mocks.onTrack = options.onTrack;
    return { transport: { close: vi.fn() }, receive: vi.fn() };
  },
}));

let surface: PipSurface | null = null;

function Probe() {
  surface = usePipMedia();
  // Muted like the call window's own picture: it never carries audio.
  return <video ref={surface.videoRef} muted />;
}

/** Makes the element report a decoded frame of `width` pixels. */
function decode(video: HTMLVideoElement, width: number) {
  Object.defineProperty(video, "videoWidth", { configurable: true, value: width });
  act(() => {
    video.dispatchEvent(new Event("loadeddata"));
  });
}

beforeEach(() => {
  mocks.onTrack = null;
  surface = null;
  vi.stubGlobal(
    "MediaStream",
    class {
      constructor(readonly tracks: MediaStreamTrack[]) {}
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});

describe("usePipMedia", () => {
  it("keeps the avatars until the received track decodes a frame", () => {
    const { container } = render(<Probe />);
    const video = container.querySelector("video") as HTMLVideoElement;
    act(() => {
      mocks.onTrack?.({ kind: "video" } as MediaStreamTrack);
    });
    // A track that never delivers a frame (a paused camera) must not draw black.
    expect(surface?.kind).toBe("none");
    decode(video, 0);
    expect(surface?.kind).toBe("none");
    decode(video, 640);
    expect(surface?.kind).toBe("loopback");
  });
});
