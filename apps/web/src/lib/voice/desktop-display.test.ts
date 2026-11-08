import type { StreamProfile } from "@aulora/core";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  type CaptureFrame,
  captureDisplayFrame,
  type DisplaySource,
  type FrameSurface,
  frameBytes,
  listDisplaySources,
  openCapturePermissionSettings,
  openDisplayStream,
  requestScreenCapturePermission,
  screenCapturePermission,
} from "./desktop-display";

const SOURCE: DisplaySource = { id: "screen:1", name: "Screen 1", kind: "screen", thumbnail: null };

const PROFILE: StreamProfile = {
  width: 1920,
  height: 1080,
  frameRate: 10,
  maxBitrate: 2_200_000,
};

const FRAME: CaptureFrame = { mime: "image/jpeg", data: "AAAA", width: 1280, height: 720 };

interface Harness {
  readonly track: MediaStreamTrack & { stop: Mock; dispatchEvent: Mock };
  readonly surface: FrameSurface & { draw: Mock; captureStream: Mock };
  readonly createSurface: (width: number, height: number) => FrameSurface | null;
}

function harness(): Harness {
  const track = {
    stop: vi.fn(),
    dispatchEvent: vi.fn(),
    readyState: "live",
  } as unknown as Harness["track"];
  const surface = {
    draw: vi.fn(async () => {}),
    captureStream: vi.fn(() => track),
  } as unknown as Harness["surface"];
  const createSurface = vi.fn<(width: number, height: number) => FrameSurface | null>(
    () => surface,
  );
  return { track, surface, createSurface };
}

describe("desktop capture bridge", () => {
  const globalWithTauri = globalThis as { __TAURI__?: unknown };
  const saved = globalWithTauri.__TAURI__;

  afterEach(() => {
    if (saved === undefined) {
      delete globalWithTauri.__TAURI__;
    } else {
      globalWithTauri.__TAURI__ = saved;
    }
  });

  it("lists the shell's sources and drops unusable entries", async () => {
    const invoke = vi.fn(() =>
      Promise.resolve([
        { id: "screen:1", name: "Screen 1 (1920×1080)", kind: "screen", thumbnail: "data:x" },
        { id: "window:4", name: "Notes", kind: "window", thumbnail: null },
        { id: "", name: "Broken", kind: "screen", thumbnail: null },
        { id: "tab:2", name: "Wrong kind", kind: "tab", thumbnail: null },
        "not a source",
      ]),
    );
    globalWithTauri.__TAURI__ = { core: { invoke } };

    await expect(listDisplaySources()).resolves.toEqual([
      { id: "screen:1", name: "Screen 1 (1920×1080)", kind: "screen", thumbnail: "data:x" },
      { id: "window:4", name: "Notes", kind: "window", thumbnail: null },
    ]);
    expect(invoke).toHaveBeenCalledWith("list_capture_sources", undefined);
  });

  it("asks for one scaled frame of a source", async () => {
    const invoke = vi.fn(() =>
      Promise.resolve({ data: "AAAA", width: 1280, height: 720, mime: "image/jpeg" }),
    );
    globalWithTauri.__TAURI__ = { core: { invoke } };

    await expect(captureDisplayFrame("screen:1", 1920, 1080)).resolves.toEqual(FRAME);
    expect(invoke).toHaveBeenCalledWith("capture_source_frame", {
      sourceId: "screen:1",
      maxWidth: 1920,
      maxHeight: 1080,
    });
  });

  it("rejects an unreadable frame instead of drawing nothing", async () => {
    globalWithTauri.__TAURI__ = { core: { invoke: () => Promise.resolve({ data: "" }) } };
    await expect(captureDisplayFrame("screen:1", 1920, 1080)).rejects.toThrow(
      "unreadable screen frame",
    );
  });

  it("reports a missing bridge", async () => {
    delete globalWithTauri.__TAURI__;
    await expect(listDisplaySources()).rejects.toThrow("Tauri invoke bridge is unavailable");
  });
});

describe("screen capture permission", () => {
  const globalWithTauri = globalThis as { __TAURI__?: unknown };
  const saved = globalWithTauri.__TAURI__;

  afterEach(() => {
    if (saved === undefined) {
      delete globalWithTauri.__TAURI__;
    } else {
      globalWithTauri.__TAURI__ = saved;
    }
  });

  it("reads the OS verdict without prompting", async () => {
    const invoke = vi.fn(() =>
      Promise.resolve({
        status: "denied",
        canOpenSettings: true,
        detail: "Aulora needs Screen Recording access.",
      }),
    );
    globalWithTauri.__TAURI__ = { core: { invoke } };

    await expect(screenCapturePermission()).resolves.toEqual({
      status: "denied",
      canOpenSettings: true,
      detail: "Aulora needs Screen Recording access.",
    });
    expect(invoke).toHaveBeenCalledWith("screen_capture_permission", { request: false });
  });

  it("asks the OS when access is requested", async () => {
    const invoke = vi.fn(() =>
      Promise.resolve({ status: "granted", canOpenSettings: false, detail: null }),
    );
    globalWithTauri.__TAURI__ = { core: { invoke } };

    await expect(requestScreenCapturePermission()).resolves.toMatchObject({ status: "granted" });
    expect(invoke).toHaveBeenCalledWith("screen_capture_permission", { request: true });
  });

  it("rejects a verdict it cannot read", async () => {
    globalWithTauri.__TAURI__ = {
      core: { invoke: () => Promise.resolve({ status: "maybe", canOpenSettings: "yes" }) },
    };
    await expect(screenCapturePermission()).rejects.toThrow("usable screen sharing permission");
  });

  it("opens the settings pane through the shell", async () => {
    const invoke = vi.fn(() => Promise.resolve(null));
    globalWithTauri.__TAURI__ = { core: { invoke } };

    await openCapturePermissionSettings();
    expect(invoke).toHaveBeenCalledWith("open_capture_permission_settings", undefined);
  });
});

describe("frameBytes", () => {
  it("decodes the base64 a frame carries", () => {
    expect([...new Uint8Array(frameBytes("AAECAw=="))]).toEqual([0, 1, 2, 3]);
    // A real JPEG prefix, which is what the shell sends.
    expect([...new Uint8Array(frameBytes("/9j/"))].slice(0, 2)).toEqual([0xff, 0xd8]);
    expect(new Uint8Array(frameBytes("")).length).toBe(0);
  });
});

describe("openDisplayStream", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sizes the surface from the first frame and captures it", async () => {
    const { track, surface, createSurface } = harness();
    const captureFrame = vi.fn(async () => FRAME);

    const stream = await openDisplayStream(SOURCE, PROFILE, { captureFrame, createSurface });

    expect(createSurface).toHaveBeenCalledWith(FRAME.width, FRAME.height);
    expect(surface.draw).toHaveBeenCalledWith(FRAME);
    expect(surface.captureStream).toHaveBeenCalledWith(10);
    expect(stream.track).toBe(track);
    expect(captureFrame).toHaveBeenCalledWith(SOURCE.id, PROFILE.width, PROFILE.height);

    stream.stop();
    expect(track.stop).toHaveBeenCalledTimes(1);
    // A person stopping the share does not fake an `ended` event.
    expect(track.dispatchEvent).not.toHaveBeenCalled();
  });

  it("stops when the first frame fails", async () => {
    const { createSurface } = harness();
    const captureFrame = vi.fn(async () => {
      throw new Error("That window is no longer available.");
    });

    await expect(
      openDisplayStream(SOURCE, PROFILE, { captureFrame, createSurface }),
    ).rejects.toThrow("That window is no longer available.");
    expect(createSurface).not.toHaveBeenCalled();
  });

  it("awaits each frame before asking for the next one", async () => {
    vi.useFakeTimers();
    const { createSurface } = harness();
    let pending: ((frame: CaptureFrame) => void) | null = null;
    const captureFrame = vi.fn(() => {
      if (captureFrame.mock.calls.length === 1) {
        return Promise.resolve(FRAME);
      }
      return new Promise<CaptureFrame>((resolve) => {
        pending = resolve;
      });
    });

    const stream = await openDisplayStream(SOURCE, PROFILE, { captureFrame, createSurface });
    await vi.advanceTimersByTimeAsync(0);
    expect(captureFrame).toHaveBeenCalledTimes(2);

    // A capture still in flight never stacks up behind the frame rate.
    await vi.advanceTimersByTimeAsync(500);
    expect(captureFrame).toHaveBeenCalledTimes(2);

    const resume = pending as ((frame: CaptureFrame) => void) | null;
    resume?.(FRAME);
    await vi.advanceTimersByTimeAsync(100);
    expect(captureFrame).toHaveBeenCalledTimes(3);

    stream.stop();
  });

  it("paces frames at the profile's frame rate", async () => {
    vi.useFakeTimers();
    const { createSurface } = harness();
    const captureFrame = vi.fn(async () => FRAME);

    const stream = await openDisplayStream(SOURCE, PROFILE, { captureFrame, createSurface });
    // One frame paints the surface, then the poll loop keeps pulling.
    await vi.advanceTimersByTimeAsync(0);
    const afterStart = captureFrame.mock.calls.length;
    await vi.advanceTimersByTimeAsync(300);

    const frames = captureFrame.mock.calls.length - afterStart;
    // 300 ms at 10 fps is three more frames; a slow runner may land on two.
    expect(frames).toBeGreaterThanOrEqual(2);
    expect(frames).toBeLessThanOrEqual(4);
    stream.stop();
  });

  it("stops the track and the loop once stopped", async () => {
    vi.useFakeTimers();
    const { track, createSurface } = harness();
    const captureFrame = vi.fn(async () => FRAME);

    const stream = await openDisplayStream(SOURCE, PROFILE, { captureFrame, createSurface });
    await vi.advanceTimersByTimeAsync(0);
    stream.stop();
    stream.stop();
    const calls = captureFrame.mock.calls.length;
    expect(track.stop).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(captureFrame).toHaveBeenCalledTimes(calls);
  });

  it("gives up after the source keeps failing", async () => {
    vi.useFakeTimers();
    const { track, createSurface } = harness();
    const captureFrame = vi.fn().mockResolvedValueOnce(FRAME).mockRejectedValue(new Error("gone"));

    const stream = await openDisplayStream(SOURCE, PROFILE, { captureFrame, createSurface });
    await vi.advanceTimersByTimeAsync(4000);

    expect(track.stop).toHaveBeenCalledTimes(1);
    // A vanished source ends the track, so the share does not freeze on screen.
    expect(track.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(track.dispatchEvent.mock.calls[0]?.[0]).toMatchObject({ type: "ended" });
    const calls = captureFrame.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(captureFrame).toHaveBeenCalledTimes(calls);
    expect(stream.track).toBe(track);
  });

  it("fails clearly when the surface cannot be drawn", async () => {
    const captureFrame = vi.fn(async () => FRAME);
    await expect(
      openDisplayStream(SOURCE, PROFILE, { captureFrame, createSurface: () => null }),
    ).rejects.toThrow("cannot draw the shared screen");
  });
});
