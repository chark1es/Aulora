import type { RecordingInput } from "expo-audio";
import { describe, expect, it, vi } from "vitest";

import {
  type AudioRouteSwitcher,
  applySavedRoute,
  type CommunicationRoute,
  type CurrentInputSource,
  NO_SAVED_ROUTE_PROGRESS,
  readPlatformCurrentInput,
  recordSavedRouteAttempt,
  routeInputFromCommunicationDevice,
  savedRouteSignature,
  selectAudioRoute,
} from "../src/lib/voice/audio-route-platform";

const iosInput: RecordingInput = {
  uid: "ios-input",
  name: "iPhone Microphone",
  type: "MicrophoneBuiltIn",
};

const builtin: RecordingInput = {
  uid: "1",
  name: "Built-in microphone",
  type: "MicrophoneBuiltIn",
};
const headset: RecordingInput = {
  uid: "2",
  name: "AirPods Pro",
  type: "BluetoothSCO",
};

function route(overrides: Partial<CommunicationRoute> = {}): CommunicationRoute {
  return {
    available: true,
    list: () => [
      { uid: "2", name: "AirPods Pro", type: "Bluetooth" },
      { uid: "3", name: "Built-in speaker", type: "Built-in speaker" },
    ],
    get: () => ({ uid: "2", name: "AirPods Pro", type: "BluetoothSCO" }),
    set: () => true,
    clear: () => true,
    ...overrides,
  };
}

const devices = [
  { deviceId: "mic-1", kind: "audioinput" as const, label: "Built-in Microphone" },
  { deviceId: "speaker-1", kind: "audiooutput" as const, label: "Speaker" },
];

describe("readPlatformCurrentInput", () => {
  it("accepts the synchronous iOS dictionary and awaits it safely", async () => {
    const recorder: CurrentInputSource = {
      getCurrentInput: () => iosInput,
    };
    await expect(readPlatformCurrentInput(recorder, "ios")).resolves.toEqual(iosInput);
  });

  it("contains a synchronous native throw", async () => {
    const recorder: CurrentInputSource = {
      getCurrentInput: () => {
        throw new Error("native route unavailable");
      },
    };
    await expect(readPlatformCurrentInput(recorder, "ios")).rejects.toThrow("native route");
  });

  it("contains an asynchronous rejection", async () => {
    const recorder: CurrentInputSource = {
      getCurrentInput: () => Promise.reject(new Error("rejected")),
    };
    await expect(readPlatformCurrentInput(recorder, "ios")).rejects.toThrow("rejected");
  });

  it("accepts a real Promise result", async () => {
    const recorder: CurrentInputSource = {
      getCurrentInput: () => Promise.resolve(iosInput),
    };
    await expect(readPlatformCurrentInput(recorder, "ios")).resolves.toEqual(iosInput);
  });

  it("reads Android's communication device, not the unprepared recorder fallback", async () => {
    const getCurrentInput = vi.fn(() => builtin);
    const recorder: CurrentInputSource = { getCurrentInput };
    const live = route();

    await expect(readPlatformCurrentInput(recorder, "android", live)).resolves.toEqual({
      uid: "2",
      name: "AirPods Pro",
      type: "BluetoothSCO",
    });
    // A recorder that would report built-in is never consulted for the call.
    expect(getCurrentInput).not.toHaveBeenCalled();
  });

  it("reports Android's route as unknown without the communication bridge", async () => {
    const getCurrentInput = vi.fn(() => builtin);
    const recorder: CurrentInputSource = { getCurrentInput };
    const unavailable = route({ available: false, get: () => builtin as never });

    await expect(readPlatformCurrentInput(recorder, "android", unavailable)).resolves.toBeNull();
    expect(getCurrentInput).not.toHaveBeenCalled();
  });

  it("does not invent a current device when Android reports none", async () => {
    const recorder: CurrentInputSource = { getCurrentInput: () => builtin };
    await expect(
      readPlatformCurrentInput(recorder, "android", route({ get: () => null })),
    ).resolves.toBeNull();
  });

  it("maps an Android communication device onto the route list shape", () => {
    expect(
      routeInputFromCommunicationDevice({
        uid: "2",
        name: "AirPods Pro",
        type: "BluetoothSCO",
      }),
    ).toEqual(headset);
  });
});

describe("Android communication sink domain", () => {
  it("keeps the recorder source id distinct from the communication sink id", async () => {
    // One headset exposes a capture/source endpoint and a communication sink
    // endpoint with different native ids. The bridge is authoritative and must
    // be read and written in the sink domain; the recorder source id is not a
    // selectable communication device.
    const source: RecordingInput = { uid: "41", name: "AirPods Pro", type: "BluetoothSCO" };
    const sink = { uid: "42", name: "AirPods Pro", type: "Bluetooth" };
    const set = vi.fn((uid: string) => uid === "42");
    const live = route({ list: () => [sink], get: () => sink, set });
    const recorder: CurrentInputSource = { getCurrentInput: () => source };

    await expect(readPlatformCurrentInput(recorder, "android", live)).resolves.toEqual({
      uid: "42",
      name: "AirPods Pro",
      type: "Bluetooth",
    });
    expect(live.list()[0]?.uid).not.toBe(source.uid);

    const sinks = [routeInputFromCommunicationDevice(sink)];
    const apply = vi.fn(() => undefined);
    expect(applySavedRoute(sinks, devices, "native:42", null, apply)).toEqual({
      status: "applied",
    });
    expect(apply).toHaveBeenCalledWith({ route: "bluetooth", uid: "42" });

    // The source id is not enumerated as a sink, so it stays pending instead
    // of silently succeeding against the wrong endpoint.
    const reject = vi.fn(() => undefined);
    expect(applySavedRoute(sinks, devices, "native:41", null, reject)).toEqual({
      status: "pending",
    });
    expect(reject).not.toHaveBeenCalled();
  });

  it("reports an unknown Android route when capability is absent, never a fake label", async () => {
    const source: RecordingInput = {
      uid: "41",
      name: "Built-in microphone",
      type: "MicrophoneBuiltIn",
    };
    const recorder: CurrentInputSource = { getCurrentInput: vi.fn(() => source) };
    const legacy = route({ available: false, list: () => [], get: () => null });

    await expect(readPlatformCurrentInput(recorder, "android", legacy)).resolves.toBeNull();
    expect(recorder.getCurrentInput).not.toHaveBeenCalled();
  });
});

describe("applySavedRoute", () => {
  it("stays pending until a delayed native route is enumerated, then applies it", () => {
    const apply = vi.fn(() => undefined);
    expect(applySavedRoute([], devices, "native:2", null, apply)).toEqual({ status: "pending" });
    expect(apply).not.toHaveBeenCalled();

    expect(applySavedRoute([builtin, headset], devices, "native:2", null, apply)).toEqual({
      status: "applied",
    });
    expect(apply).toHaveBeenCalledWith({ route: "bluetooth", uid: "2" });
  });

  it("prefers the saved output route when both are set", () => {
    const apply = vi.fn(() => undefined);
    expect(applySavedRoute([builtin, headset], devices, "native:2", "speaker-1", apply)).toEqual({
      status: "applied",
    });
    expect(apply).toHaveBeenCalledWith({ route: "device" });
  });

  it("returns the platform failure instead of a successful no-op", () => {
    const apply = vi.fn(() => "The system rejected the audio route switch.");
    expect(applySavedRoute([builtin, headset], devices, "native:2", null, apply)).toEqual({
      status: "failed",
      message: "The system rejected the audio route switch.",
    });
  });

  it("treats no saved choice as nothing to apply", () => {
    const apply = vi.fn(() => undefined);
    expect(applySavedRoute([builtin], devices, null, null, apply)).toEqual({ status: "none" });
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("call-entry route progress", () => {
  it("does not latch a pending route, then latches success without reporting", () => {
    const signature = savedRouteSignature("call-1", "native:2", null);
    const pending = recordSavedRouteAttempt(NO_SAVED_ROUTE_PROGRESS, signature, {
      status: "pending",
    });
    expect(pending.progress.appliedSignature).toBeNull();
    expect(pending.shouldReport).toBe(false);

    const applied = recordSavedRouteAttempt(pending.progress, signature, { status: "applied" });
    expect(applied.progress.appliedSignature).toBe(signature);
    expect(applied.shouldReport).toBe(false);
  });

  it("reports a failure once and retries the same signature until it succeeds", () => {
    const signature = savedRouteSignature("call-1", "native:2", null);
    const failed = recordSavedRouteAttempt(NO_SAVED_ROUTE_PROGRESS, signature, {
      status: "failed",
      message: "The system rejected the audio route switch.",
    });
    expect(failed.shouldReport).toBe(true);
    expect(failed.progress.appliedSignature).toBeNull();

    const retryFailed = recordSavedRouteAttempt(failed.progress, signature, {
      status: "failed",
      message: "The system rejected the audio route switch.",
    });
    expect(retryFailed.shouldReport).toBe(false);
    expect(retryFailed.progress.appliedSignature).toBeNull();

    const applied = recordSavedRouteAttempt(retryFailed.progress, signature, {
      status: "applied",
    });
    expect(applied.progress.appliedSignature).toBe(signature);
    expect(applied.shouldReport).toBe(false);
  });
});

describe("selectAudioRoute", () => {
  function switcher(overrides: Partial<AudioRouteSwitcher> = {}): AudioRouteSwitcher {
    return {
      getCurrentInput: () => iosInput,
      setInput: vi.fn(),
      ...overrides,
    };
  }

  it("sets and reads back an Android communication sink before marking it active", () => {
    const sink = { uid: "42", name: "AirPods Pro", type: "Bluetooth" };
    const set = vi.fn(() => true);
    const setActiveUid = vi.fn();
    const live = route({ list: () => [sink], get: () => sink, set });
    const recorder = switcher();

    expect(
      selectAudioRoute(
        { route: "bluetooth", uid: "42" },
        [routeInputFromCommunicationDevice(sink)],
        "android",
        live,
        recorder,
        setActiveUid,
      ),
    ).toBeUndefined();
    expect(set).toHaveBeenCalledWith("42");
    expect(setActiveUid).toHaveBeenCalledWith("42");
    // The recorder's source endpoint is a different domain.
    expect(recorder.setInput).not.toHaveBeenCalled();
  });

  it("keeps the previous route when Android does not confirm the readback", () => {
    const sink = { uid: "42", name: "AirPods Pro", type: "Bluetooth" };
    const setActiveUid = vi.fn();

    expect(
      selectAudioRoute(
        { route: "bluetooth", uid: "42" },
        [routeInputFromCommunicationDevice(sink)],
        "android",
        route({ get: () => ({ uid: "3", name: "Built-in speaker", type: "Built-in speaker" }) }),
        switcher(),
        setActiveUid,
      ),
    ).toBe("The system did not confirm the audio route switch.");
    expect(setActiveUid).not.toHaveBeenCalled();
  });

  it("clears the pinned device for Android system default and reports a refused clear", () => {
    const setActiveUid = vi.fn();
    expect(
      selectAudioRoute({ route: "system" }, [], "android", route(), switcher(), setActiveUid),
    ).toBeUndefined();
    expect(setActiveUid).toHaveBeenCalledWith(undefined);

    setActiveUid.mockClear();
    expect(
      selectAudioRoute(
        { route: "system" },
        [],
        "android",
        route({ clear: () => false }),
        switcher(),
        setActiveUid,
      ),
    ).toBe("The system rejected the audio route change.");
    expect(setActiveUid).not.toHaveBeenCalled();
  });

  it("requests the recorder input on legacy Android without claiming a known route", () => {
    const setInput = vi.fn();
    const setActiveUid = vi.fn();
    expect(
      selectAudioRoute(
        { route: "bluetooth" },
        [headset],
        "android",
        route({ available: false }),
        switcher({ setInput }),
        setActiveUid,
      ),
    ).toBeUndefined();
    expect(setInput).toHaveBeenCalledWith("2");
    expect(setActiveUid).toHaveBeenCalledWith(undefined);
  });

  it("uses iOS's synchronous confirmation and leaves unknown routes unset", () => {
    const setInput = vi.fn();
    const setActiveUid = vi.fn();
    expect(
      selectAudioRoute(
        { route: "bluetooth" },
        [iosInput, headset],
        "ios",
        route({ available: false }),
        switcher({ setInput, getCurrentInput: () => headset }),
        setActiveUid,
      ),
    ).toBeUndefined();
    expect(setInput).toHaveBeenCalledWith("2");
    expect(setActiveUid).toHaveBeenCalledWith("2");

    setActiveUid.mockClear();
    expect(
      selectAudioRoute(
        { route: "bluetooth" },
        [iosInput, headset],
        "ios",
        route({ available: false }),
        switcher({ getCurrentInput: () => Promise.resolve(headset) }),
        setActiveUid,
      ),
    ).toBeUndefined();
    // A Promise cannot be read synchronously, so the route stays unknown.
    expect(setActiveUid).toHaveBeenCalledWith(undefined);
  });

  it("rejects a target that is not enumerated without touching the active route", () => {
    const setActiveUid = vi.fn();
    expect(
      selectAudioRoute(
        { route: "bluetooth" },
        [],
        "ios",
        route({ available: false }),
        switcher(),
        setActiveUid,
      ),
    ).toBe("This device cannot switch to that audio route.");
    expect(setActiveUid).not.toHaveBeenCalled();
  });
});
