import { DEFAULT_VOICE_SETTINGS, streamProfile, type VoiceDeviceSettings } from "@aulora/core";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { CapturePermission, DisplaySource, SystemAudioSupport } from "./desktop-display";
import { acquireDisplay } from "./display";
import { cancelDisplayPicker, confirmDisplayPicker, getDisplayPickerState } from "./display-picker";

const bridge = vi.hoisted(() => ({
  openDisplayStream: vi.fn(),
  listDisplaySources: vi.fn(),
  screenCapturePermission: vi.fn(),
  requestScreenCapturePermission: vi.fn(),
  openCapturePermissionSettings: vi.fn(),
  systemAudioSupport: vi.fn(),
  openSystemAudioStream: vi.fn(),
}));

vi.mock("./desktop-display", () => ({
  listDisplaySources: bridge.listDisplaySources,
  openDisplayStream: bridge.openDisplayStream,
  screenCapturePermission: bridge.screenCapturePermission,
  requestScreenCapturePermission: bridge.requestScreenCapturePermission,
  openCapturePermissionSettings: bridge.openCapturePermissionSettings,
  systemAudioSupport: bridge.systemAudioSupport,
}));

vi.mock("./system-audio", () => ({
  openSystemAudioStream: bridge.openSystemAudioStream,
}));

const ALLOWED: CapturePermission = { status: "granted", canOpenSettings: false, detail: null };

const AUDIO_ON: SystemAudioSupport = {
  supported: true,
  backend: "pulse-monitor",
  detail: "Records the default output's monitor source.",
};

const DENIED: CapturePermission = {
  status: "denied",
  canOpenSettings: true,
  detail:
    "Aulora needs Screen Recording access to share your screen. Allow Aulora in System Settings.",
};

const SCREEN: DisplaySource = {
  id: "screen:1",
  name: "Screen 1 (1920×1080)",
  kind: "screen",
  thumbnail: null,
};

const WINDOW: DisplaySource = {
  id: "window:3",
  name: "Notes — Editor",
  kind: "window",
  thumbnail: null,
};

function settings(overrides: Partial<VoiceDeviceSettings> = {}): VoiceDeviceSettings {
  return { ...DEFAULT_VOICE_SETTINGS, streamQuality: "balanced", ...overrides };
}

function fakeTrack(kind: "video" | "audio" = "video"): MediaStreamTrack & { stop: Mock } {
  return { kind, stop: vi.fn(), contentHint: "" } as unknown as MediaStreamTrack & { stop: Mock };
}

/** Waits for the picker to reach `status` without guessing at a delay. */
async function waitForPicker(status: "ready" | "error" | "permission"): Promise<void> {
  await vi.waitFor(() => {
    expect(getDisplayPickerState().status).toBe(status);
  });
}

function stubMediaDevices(value: Partial<MediaDevices>): void {
  Object.defineProperty(navigator, "mediaDevices", { value, configurable: true });
}

const globalWithTauri = globalThis as { __TAURI__?: unknown };

afterEach(() => {
  Reflect.deleteProperty(navigator, "mediaDevices");
  cancelDisplayPicker();
  delete globalWithTauri.__TAURI__;
  vi.clearAllMocks();
});

describe("acquireDisplay in the desktop shell", () => {
  beforeEach(() => {
    globalWithTauri.__TAURI__ = { core: { invoke: () => Promise.resolve() } };
    bridge.screenCapturePermission.mockResolvedValue(ALLOWED);
    bridge.requestScreenCapturePermission.mockResolvedValue(ALLOWED);
    bridge.openCapturePermissionSettings.mockResolvedValue(undefined);
    bridge.systemAudioSupport.mockResolvedValue(AUDIO_ON);
    bridge.listDisplaySources.mockResolvedValue([SCREEN, WINDOW]);
  });

  it("shares the source picked in Aulora's own dialog", async () => {
    const track = fakeTrack();
    const stop = vi.fn();
    const audioTrack = fakeTrack("audio");
    const stopAudio = vi.fn();
    bridge.openDisplayStream.mockResolvedValue({ track, stop });
    bridge.openSystemAudioStream.mockResolvedValue({ track: audioTrack, stop: stopAudio });
    const getDisplayMedia = vi.fn();
    stubMediaDevices({ getDisplayMedia });

    const pending = acquireDisplay(settings());
    await waitForPicker("ready");

    confirmDisplayPicker();
    const capture = await pending;

    expect(capture.video).toBe(track);
    expect(capture.audio).toBe(audioTrack);
    expect(capture.notice).toBeNull();
    expect(bridge.openDisplayStream).toHaveBeenCalledWith(
      SCREEN,
      streamProfile(settings().streamQuality),
    );
    expect(bridge.openSystemAudioStream).toHaveBeenCalledWith(SCREEN.id);
    expect(getDisplayMedia).not.toHaveBeenCalled();

    capture.stop();
    capture.stop();
    expect(stop).toHaveBeenCalledTimes(2);
    expect(stopAudio).toHaveBeenCalledTimes(2);
  });

  it("treats a cancelled picker as no share at all", async () => {
    const pending = acquireDisplay(settings());
    await waitForPicker("ready");
    cancelDisplayPicker();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(bridge.openDisplayStream).not.toHaveBeenCalled();
  });

  it("leaves the system audio capture alone when the toggle is off", async () => {
    bridge.openDisplayStream.mockResolvedValue({ track: fakeTrack(), stop: vi.fn() });

    const pending = acquireDisplay(settings({ streamAudio: false }));
    await waitForPicker("ready");
    confirmDisplayPicker();
    const capture = await pending;

    expect(capture.audio).toBeNull();
    expect(bridge.openSystemAudioStream).not.toHaveBeenCalled();
  });

  it("keeps the video share when the audio backend fails", async () => {
    const track = fakeTrack();
    bridge.openDisplayStream.mockResolvedValue({ track, stop: vi.fn() });
    bridge.openSystemAudioStream.mockRejectedValue(new Error("PulseAudio is not running."));

    const pending = acquireDisplay(settings({ streamAudio: true }));
    await waitForPicker("ready");
    confirmDisplayPicker();
    const capture = await pending;

    expect(capture.video).toBe(track);
    expect(capture.audio).toBeNull();
    expect(capture.notice).toContain("PulseAudio is not running.");
  });

  it("stops before capturing when the OS permission is missing", async () => {
    bridge.screenCapturePermission.mockResolvedValue(DENIED);
    bridge.listDisplaySources.mockClear();

    const pending = acquireDisplay(settings());
    await waitForPicker("permission");

    // Nothing is listed or captured, and the call gets the reason, not a
    // silent no-op.
    expect(bridge.listDisplaySources).not.toHaveBeenCalled();
    expect(bridge.openDisplayStream).not.toHaveBeenCalled();
    const declined = expect(pending).rejects.toThrow("Screen Recording access");
    cancelDisplayPicker();
    await declined;
  });

  it("passes a capture failure to the caller", async () => {
    bridge.openDisplayStream.mockRejectedValue(new Error("That window is no longer available."));

    const pending = acquireDisplay(settings());
    await waitForPicker("ready");
    confirmDisplayPicker();

    await expect(pending).rejects.toThrow("That window is no longer available.");
  });

  it("reports a shell that cannot list sources", async () => {
    bridge.listDisplaySources.mockRejectedValue(new Error("Could not list screens: denied"));

    const pending = acquireDisplay(settings());
    await waitForPicker("error");

    expect(getDisplayPickerState()).toMatchObject({
      status: "error",
      error: "Could not list screens: denied",
    });
    cancelDisplayPicker();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("acquireDisplay in a browser", () => {
  beforeEach(() => {
    delete globalWithTauri.__TAURI__;
  });

  it("uses the engine picker unchanged", async () => {
    const video = fakeTrack();
    const audio = fakeTrack("audio");
    const getDisplayMedia = vi.fn(
      async () =>
        ({
          getVideoTracks: () => [video],
          getAudioTracks: () => [audio],
          getTracks: () => [video, audio],
        }) as unknown as MediaStream,
    );
    stubMediaDevices({ getDisplayMedia });

    const capture = await acquireDisplay(settings({ streamAudio: true }));

    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(capture.video).toBe(video);
    expect(capture.audio).toBe(audio);
    expect(bridge.openDisplayStream).not.toHaveBeenCalled();
    expect(bridge.listDisplaySources).not.toHaveBeenCalled();

    capture.stop();
    expect(video.stop).toHaveBeenCalledTimes(1);
    expect(audio.stop).toHaveBeenCalledTimes(1);
  });

  it("rejects a device without screen capture", async () => {
    Object.defineProperty(navigator, "mediaDevices", { value: {}, configurable: true });
    await expect(acquireDisplay(settings())).rejects.toThrow("cannot share its screen");
  });

  it("rejects a picker that produced no video track", async () => {
    const getDisplayMedia = vi.fn(
      async () =>
        ({
          getVideoTracks: () => [],
          getAudioTracks: () => [],
          getTracks: () => [],
        }) as unknown as MediaStream,
    );
    stubMediaDevices({ getDisplayMedia });
    await expect(acquireDisplay(settings())).rejects.toThrow("No screen track was produced");
  });
});
