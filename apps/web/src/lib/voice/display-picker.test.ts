import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapturePermission, DisplaySource, SystemAudioSupport } from "./desktop-display";
import {
  cancelDisplayPicker,
  confirmDisplayPicker,
  getDisplayPickerState,
  openDisplayPermissionSettings,
  requestDisplaySource,
  retryDisplayPicker,
  selectDisplaySource,
  setDisplayAudioRequested,
  subscribeDisplayPicker,
} from "./display-picker";

const SCREEN: DisplaySource = {
  id: "screen:1",
  name: "Screen 1 (1920×1080)",
  kind: "screen",
  thumbnail: null,
};

const SECOND_SCREEN: DisplaySource = {
  id: "screen:2",
  name: "Screen 2 (2560×1440)",
  kind: "screen",
  thumbnail: "data:image/jpeg;base64,AAAA",
};

const WINDOW: DisplaySource = {
  id: "window:9",
  name: "Notes — Editor",
  kind: "window",
  thumbnail: null,
};

/** Lets the pending tile load settle before the state is asserted. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const ALLOWED: CapturePermission = { status: "granted", canOpenSettings: false, detail: null };

const DENIED: CapturePermission = {
  status: "denied",
  canOpenSettings: true,
  detail: "Aulora needs Screen Recording access to share your screen.",
};

const AUDIO_ON: SystemAudioSupport = {
  supported: true,
  backend: "wasapi-loopback",
  detail: "Captures the default output without Aulora's own audio.",
};

const AUDIO_OFF: SystemAudioSupport = {
  supported: false,
  backend: "screencapturekit",
  detail: "macOS 13 or newer is needed to capture system audio.",
};

const UNSUPPORTED: CapturePermission = {
  status: "unsupported",
  canOpenSettings: false,
  detail: "This Wayland session doesn't let apps read the screen continuously.",
};

/** Opens the picker with the permission granted and audio available. */
function openWithSources(listSources: () => Promise<DisplaySource[]>, audioRequested = false) {
  return requestDisplaySource({
    readPermission: async () => ALLOWED,
    readAudio: async () => AUDIO_ON,
    listSources,
    audioRequested,
  });
}

afterEach(() => {
  // A cancelled request resets the store; this keeps a failed assertion from
  // leaking an open picker into the next test.
  cancelDisplayPicker();
});

describe("display picker request", () => {
  it("opens on the screens and preselects the first one", async () => {
    const request = requestDisplaySource({
      audioRequested: true,
      readPermission: async () => ALLOWED,
      readAudio: async () => AUDIO_ON,
      listSources: async () => [SECOND_SCREEN, WINDOW],
    });
    expect(getDisplayPickerState().status).toBe("checking");
    await flush();
    expect(getDisplayPickerState()).toMatchObject({
      status: "ready",
      selectedId: SECOND_SCREEN.id,
      audioRequested: true,
    });
    cancelDisplayPicker();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("resolves with the tile the person picked", async () => {
    const request = openWithSources(async () => [SCREEN, WINDOW]);
    await flush();
    expect(getDisplayPickerState().selectedId).toBe(SCREEN.id);

    selectDisplaySource(WINDOW.id);
    expect(getDisplayPickerState().selectedId).toBe(WINDOW.id);
    // Unknown tiles are ignored rather than shared by accident.
    selectDisplaySource("window:404");
    expect(getDisplayPickerState().selectedId).toBe(WINDOW.id);

    confirmDisplayPicker();
    await expect(request).resolves.toEqual({ source: WINDOW, audioRequested: false });
    expect(getDisplayPickerState().status).toBe("idle");
  });

  it("ignores selecting while the tiles are still loading", async () => {
    const request = openWithSources(async () => [SCREEN]);
    selectDisplaySource(SCREEN.id);
    expect(getDisplayPickerState().selectedId).toBeNull();
    await flush();
    confirmDisplayPicker();
    await expect(request).resolves.toEqual({ source: SCREEN, audioRequested: false });
  });

  it("reports an empty source list and can retry", async () => {
    const listSources = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([SCREEN]);
    const request = openWithSources(listSources);
    await flush();
    expect(getDisplayPickerState()).toMatchObject({ status: "error", sources: [] });

    retryDisplayPicker();
    expect(getDisplayPickerState().status).toBe("checking");
    await flush();
    expect(getDisplayPickerState()).toMatchObject({ status: "ready", selectedId: SCREEN.id });

    confirmDisplayPicker();
    await expect(request).resolves.toEqual({ source: SCREEN, audioRequested: false });
    expect(listSources).toHaveBeenCalledTimes(2);
  });

  it("surfaces a listing failure", async () => {
    const request = openWithSources(async () => {
      throw new Error("Could not list screens: permission denied");
    });
    await flush();
    expect(getDisplayPickerState()).toMatchObject({
      status: "error",
      error: "Could not list screens: permission denied",
    });
    cancelDisplayPicker();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("replaces a request that is still open", async () => {
    const first = openWithSources(async () => [SCREEN]);
    const second = openWithSources(async () => [WINDOW]);
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await flush();
    expect(getDisplayPickerState().selectedId).toBe(WINDOW.id);
    confirmDisplayPicker();
    await expect(second).resolves.toEqual({ source: WINDOW, audioRequested: false });
  });

  it("asks for the OS permission before listing any tile", async () => {
    const listSources = vi.fn(async () => [SCREEN]);
    const request = requestDisplaySource({
      readPermission: async () => DENIED,
      readAudio: async () => AUDIO_ON,
      listSources,
    });
    await flush();

    expect(getDisplayPickerState()).toMatchObject({
      status: "permission",
      permission: DENIED,
      sources: [],
    });
    expect(listSources).not.toHaveBeenCalled();

    // Declining is a real reason the share did not start, so it is reported.
    const denied = expect(request).rejects.toThrow("Screen Recording access");
    cancelDisplayPicker();
    await denied;
    expect(getDisplayPickerState().status).toBe("idle");
  });

  it("carries on to the tiles once the permission is granted", async () => {
    const readPermission = vi.fn().mockResolvedValueOnce(DENIED).mockResolvedValueOnce(ALLOWED);
    const request = requestDisplaySource({
      readPermission,
      readAudio: async () => AUDIO_ON,
      listSources: async () => [SCREEN],
    });
    await flush();
    expect(getDisplayPickerState().status).toBe("permission");

    retryDisplayPicker();
    await flush();
    expect(getDisplayPickerState()).toMatchObject({ status: "ready", selectedId: SCREEN.id });
    expect(readPermission).toHaveBeenCalledTimes(2);

    confirmDisplayPicker();
    await expect(request).resolves.toEqual({ source: SCREEN, audioRequested: false });
  });

  it("asks the OS, then opens the settings pane when it is still denied", async () => {
    const requestAccess = vi.fn(async () => DENIED);
    const openSettings = vi.fn(async () => undefined);
    const request = requestDisplaySource({
      readPermission: async () => DENIED,
      readAudio: async () => AUDIO_ON,
      requestAccess,
      openSettings,
      listSources: async () => [SCREEN],
    });
    await flush();

    await openDisplayPermissionSettings();
    expect(requestAccess).toHaveBeenCalledTimes(1);
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(getDisplayPickerState().status).toBe("permission");

    cancelDisplayPicker();
    await expect(request).rejects.toThrow("Screen Recording access");
  });

  it("goes straight to the tiles when opening the pane was enough", async () => {
    const openSettings = vi.fn(async () => undefined);
    // The grant lands between the first check and the one after the OS prompt.
    let permission = DENIED;
    const request = requestDisplaySource({
      readPermission: async () => permission,
      readAudio: async () => AUDIO_ON,
      requestAccess: async () => {
        permission = ALLOWED;
        return ALLOWED;
      },
      openSettings,
      listSources: async () => [SCREEN],
    });
    await flush();

    await openDisplayPermissionSettings();
    await flush();
    expect(openSettings).not.toHaveBeenCalled();
    expect(getDisplayPickerState()).toMatchObject({ status: "ready", selectedId: SCREEN.id });

    confirmDisplayPicker();
    await expect(request).resolves.toEqual({ source: SCREEN, audioRequested: false });
  });

  it("does not offer a settings pane where the OS has none", async () => {
    const requestAccess = vi.fn(async () => UNSUPPORTED);
    const openSettings = vi.fn(async () => undefined);
    const request = requestDisplaySource({
      readPermission: async () => UNSUPPORTED,
      readAudio: async () => AUDIO_ON,
      requestAccess,
      openSettings,
      listSources: async () => [SCREEN],
    });
    await flush();

    expect(getDisplayPickerState().permission).toMatchObject({ canOpenSettings: false });
    await openDisplayPermissionSettings();
    expect(requestAccess).not.toHaveBeenCalled();
    expect(openSettings).not.toHaveBeenCalled();

    const declined = expect(request).rejects.toThrow("Wayland");
    cancelDisplayPicker();
    await declined;
  });

  it("reports a permission the shell could not read", async () => {
    const request = requestDisplaySource({
      readPermission: async () => {
        throw new Error("The desktop app did not report a usable screen sharing permission.");
      },
      readAudio: async () => AUDIO_ON,
      listSources: async () => [SCREEN],
    });
    await flush();
    expect(getDisplayPickerState()).toMatchObject({ status: "error" });

    cancelDisplayPicker();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps the system audio toggle and reports the choice", async () => {
    const request = openWithSources(async () => [SCREEN], true);
    await flush();

    expect(getDisplayPickerState()).toMatchObject({ audioRequested: true, audio: AUDIO_ON });
    setDisplayAudioRequested(false);
    expect(getDisplayPickerState().audioRequested).toBe(false);
    // Selecting a tile does not disturb the audio choice.
    setDisplayAudioRequested(true);

    confirmDisplayPicker();
    await expect(request).resolves.toEqual({ source: SCREEN, audioRequested: true });
  });

  it("turns audio off where the platform cannot capture it", async () => {
    const startCapture = vi.fn();
    const request = requestDisplaySource({
      audioRequested: true,
      readPermission: async () => ALLOWED,
      readAudio: async () => AUDIO_OFF,
      listSources: async () => [SCREEN],
    });
    await flush();

    expect(getDisplayPickerState()).toMatchObject({
      audioRequested: false,
      audio: AUDIO_OFF,
    });
    // The toggle cannot be turned on where there is no backend.
    setDisplayAudioRequested(true);
    expect(getDisplayPickerState().audioRequested).toBe(false);
    expect(startCapture).not.toHaveBeenCalled();

    confirmDisplayPicker();
    await expect(request).resolves.toEqual({ source: SCREEN, audioRequested: false });
  });

  it("keeps the share usable when the audio capability cannot be read", async () => {
    const request = requestDisplaySource({
      audioRequested: true,
      readPermission: async () => ALLOWED,
      readAudio: async () => {
        throw new Error("old shell");
      },
      listSources: async () => [SCREEN],
    });
    await flush();

    expect(getDisplayPickerState()).toMatchObject({ status: "ready", audio: null });
    confirmDisplayPicker();
    await expect(request).resolves.toEqual({ source: SCREEN, audioRequested: false });
  });

  it("notifies subscribers on every change", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDisplayPicker(listener);
    const request = openWithSources(async () => [SCREEN, WINDOW]);
    await flush();
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);

    unsubscribe();
    const seen = listener.mock.calls.length;
    cancelDisplayPicker();
    expect(listener.mock.calls.length).toBe(seen);
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});
