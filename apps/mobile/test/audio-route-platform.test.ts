import type { RecordingInput } from "expo-audio";
import { describe, expect, it, vi } from "vitest";

import {
  applySavedRoute,
  type CommunicationRoute,
  type CurrentInputSource,
  NO_SAVED_ROUTE_PROGRESS,
  readPlatformCurrentInput,
  recordSavedRouteAttempt,
  routeInputFromCommunicationDevice,
  savedRouteSignature,
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
