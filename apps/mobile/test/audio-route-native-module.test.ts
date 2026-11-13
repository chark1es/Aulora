import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  modulePresent: true,
  supported: true,
  devices: [
    { uid: "42", name: "AirPods Pro", type: "Bluetooth" },
    { uid: "43", name: "Built-in speaker", type: "Built-in speaker" },
  ] as Array<{ uid: string; name: string; type: string }>,
  calls: [] as string[],
}));

vi.mock("expo", () => ({
  requireOptionalNativeModule: () =>
    state.modulePresent
      ? {
          isSupported: () => state.supported,
          getAvailableCommunicationDevices: () => state.devices,
          getCommunicationDevice: () => state.devices[0] ?? null,
          setCommunicationDevice: (uid: string) => {
            state.calls.push(`set:${uid}`);
            return uid === "42";
          },
          clearCommunicationDevice: () => {
            state.calls.push("clear");
            return true;
          },
        }
      : null,
}));

async function loadModule() {
  vi.resetModules();
  return await import("../modules/aulora-audio-route");
}

beforeEach(() => {
  state.modulePresent = true;
  state.supported = true;
  state.calls = [];
});

describe("AuloraAudioRoute JS bridge", () => {
  it("advertises the communication route only when the OS capability exists", async () => {
    // Module presence alone is not capability: Android 9-11 cannot use
    // AudioManager's communication-device API and must keep the legacy path.
    state.supported = false;
    const legacy = await loadModule();
    expect(legacy.communicationRouteAvailable).toBe(false);
    expect(legacy.getAvailableCommunicationDevices()).toEqual([]);

    state.supported = true;
    const supported = await loadModule();
    expect(supported.communicationRouteAvailable).toBe(true);
  });

  it("enumerates and selects communication sinks by their own ids", async () => {
    const bridge = await loadModule();
    expect(bridge.getAvailableCommunicationDevices().map((device) => device.uid)).toEqual([
      "42",
      "43",
    ]);
    expect(bridge.setCommunicationDevice("42")).toBe(true);
    // A recorder/source id is rejected by the native domain, not accepted here.
    expect(bridge.setCommunicationDevice("41")).toBe(false);
    expect(state.calls).toEqual(["set:42", "set:41"]);
  });

  it("returns explicit success for a clear instead of a void result", async () => {
    const bridge = await loadModule();
    expect(bridge.clearCommunicationDevice()).toBe(true);
    expect(state.calls).toEqual(["clear"]);
  });

  it("treats an absent or older module as unavailable without inventing state", async () => {
    state.modulePresent = false;
    const absent = await loadModule();
    expect(absent.communicationRouteAvailable).toBe(false);
    expect(absent.getCommunicationDevice()).toBeNull();
    expect(absent.setCommunicationDevice("42")).toBeNull();
    expect(absent.clearCommunicationDevice()).toBeNull();
  });
});
