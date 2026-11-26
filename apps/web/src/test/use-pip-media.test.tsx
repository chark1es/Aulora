import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type PipSurface, usePipMedia } from "../components/voice/use-pip-media";

const mocks = vi.hoisted(() => ({
  onTrack: null as ((track: MediaStreamTrack) => void) | null,
  order: [] as string[],
}));

vi.mock("../lib/desktop", () => ({
  emitDesktopEventTo: vi.fn(async () => undefined),
  listenDesktopEvent: vi.fn(async () => {
    mocks.order.push("listen");
    return () => undefined;
  }),
}));
vi.mock("../lib/voice/pip-frames", () => ({
  registerPipFrames: () => () => {},
  createPipFramePainter: () => ({ draw: vi.fn() }),
}));
vi.mock("../lib/voice/pip-loopback", () => ({
  loopbackSupported: () => true,
  parseLoopbackSignal: () => null,
  createPipReceiver: (options: { onTrack: (track: MediaStreamTrack) => void }) => {
    mocks.order.push("receiver");
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
  Object.defineProperty(video, "readyState", {
    configurable: true,
    value: HTMLMediaElement.HAVE_CURRENT_DATA,
  });
  act(() => {
    video.dispatchEvent(new Event("loadeddata"));
  });
}

/** Renders the hook and waits for the receiver, which starts once listening. */
async function mount() {
  const view = render(<Probe />);
  await waitFor(() => {
    expect(mocks.onTrack).not.toBeNull();
  });
  return view.container.querySelector("video") as HTMLVideoElement;
}

function receive(track: MediaStreamTrack) {
  act(() => {
    mocks.onTrack?.(track);
  });
}

beforeEach(() => {
  mocks.onTrack = null;
  mocks.order = [];
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
  it("listens for the offer before announcing itself", async () => {
    await mount();
    expect(mocks.order).toEqual(["listen", "receiver"]);
  });

  it("waits for a replacement stream's own first frame", async () => {
    const video = await mount();
    receive({ kind: "video" } as MediaStreamTrack);
    decode(video, 640);
    expect(surface?.kind).toBe("loopback");
    // The loopback restarted with a stream that has not decoded anything yet.
    receive({ kind: "video" } as MediaStreamTrack);
    expect(surface?.kind).toBe("none");
  });

  it("does not take a size from metadata for a frame", async () => {
    const video = await mount();
    receive({ kind: "video" } as MediaStreamTrack);
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 640 });
    Object.defineProperty(video, "readyState", {
      configurable: true,
      value: HTMLMediaElement.HAVE_METADATA,
    });
    act(() => {
      video.dispatchEvent(new Event("resize"));
    });
    expect(surface?.kind).toBe("none");
  });

  it("keeps the avatars until the received track decodes a frame", async () => {
    const video = await mount();
    receive({ kind: "video" } as MediaStreamTrack);
    // A track that never delivers a frame (a paused camera) must not draw black.
    expect(surface?.kind).toBe("none");
    decode(video, 0);
    expect(surface?.kind).toBe("none");
    decode(video, 640);
    expect(surface?.kind).toBe("loopback");
  });
});
