import type { RecordingInput } from "expo-audio";
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  bridgeAvailable: true,
  recorderInputs: [] as RecordingInput[],
  recorderCurrent: null as RecordingInput | null,
  sinks: [] as Array<{ uid: string; name: string; type: string }>,
  bridgeCurrent: null as { uid: string; name: string; type: string } | null,
  setInput: vi.fn(),
  setCommunication: vi.fn<(uid: string) => boolean>(),
  clear: vi.fn<() => boolean>(),
}));

vi.mock("expo-audio", () => {
  const recorder = {
    getAvailableInputs: () => native.recorderInputs,
    getCurrentInput: () => native.recorderCurrent,
    setInput: native.setInput,
  };
  return {
    RecordingPresets: { LOW_QUALITY: {} },
    useAudioRecorder: () => recorder,
  };
});

vi.mock("react-native", () => ({
  Platform: { OS: "android", Version: 33 },
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
}));

vi.mock("../modules/aulora-audio-route", () => ({
  communicationRouteAvailable: native.bridgeAvailable,
  getAvailableCommunicationDevices: () => native.sinks,
  getCommunicationDevice: () => native.bridgeCurrent,
  setCommunicationDevice: (uid: string) => native.setCommunication(uid),
  clearCommunicationDevice: () => native.clear(),
}));

const hooks = vi.hoisted(() => ({
  cells: [] as unknown[],
  slot: 0,
  changed: false,
  effects: [] as Array<() => void>,
  cleanups: [] as Array<() => void>,
}));

vi.mock("react", () => {
  const memo = (factory: () => unknown, deps: readonly unknown[]) => {
    const slot = hooks.slot++;
    const previous = hooks.cells[slot] as { deps: readonly unknown[]; value: unknown } | undefined;
    if (!previous || deps.some((dep, index) => dep !== previous.deps[index])) {
      hooks.cells[slot] = { deps, value: factory() };
    }
    return (hooks.cells[slot] as { value: unknown }).value;
  };
  return {
    useState: (initial: unknown) => {
      const slot = hooks.slot++;
      if (!(slot in hooks.cells)) hooks.cells[slot] = initial;
      return [
        hooks.cells[slot],
        (next: unknown) => {
          const value = typeof next === "function" ? next(hooks.cells[slot]) : next;
          if (value !== hooks.cells[slot]) hooks.changed = true;
          hooks.cells[slot] = value;
        },
      ];
    },
    useCallback: (callback: unknown, deps: readonly unknown[]) => memo(() => callback, deps),
    useRef: (current: unknown) => memo(() => ({ current }), []),
    useEffect: (effect: () => unknown, deps: readonly unknown[]) => {
      const slot = hooks.slot++;
      const previous = hooks.cells[slot] as
        | { deps: readonly unknown[]; cleanup?: () => void }
        | undefined;
      if (previous && deps.every((dep, index) => dep === previous.deps[index])) {
        return;
      }
      if (previous?.cleanup !== undefined) hooks.cleanups.push(previous.cleanup);
      const cell: { deps: readonly unknown[]; cleanup?: () => void } = { deps };
      hooks.cells[slot] = cell;
      hooks.effects.push(() => {
        const cleanup = effect();
        if (typeof cleanup === "function") cell.cleanup = cleanup as () => void;
      });
    },
  };
});

type AudioRouteHook = typeof import("../src/lib/voice/use-audio-route").useAudioRoute;
type AudioRoute = ReturnType<AudioRouteHook>;
type MutableRoute = { available: boolean };

let loaded: { useAudioRoute: AudioRouteHook; platformCommunicationRoute: MutableRoute } | undefined;

async function loadHook(): Promise<{
  useAudioRoute: AudioRouteHook;
  platformCommunicationRoute: MutableRoute;
}> {
  if (loaded === undefined) {
    const module = await import("../src/lib/voice/use-audio-route");
    loaded = {
      useAudioRoute: module.useAudioRoute,
      platformCommunicationRoute: module.platformCommunicationRoute as MutableRoute,
    };
  }
  // The module builds its route seam once; tests switch the capability that
  // the hook must consult at call time.
  loaded.platformCommunicationRoute.available = native.bridgeAvailable;
  return loaded;
}

let latest: AudioRoute;

function render(hook: AudioRouteHook): void {
  do {
    hooks.changed = false;
    hooks.slot = 0;
    hooks.effects = [];
    latest = hook();
    for (const cleanup of hooks.cleanups) cleanup();
    hooks.cleanups = [];
    for (const effect of hooks.effects) effect();
  } while (hooks.changed);
}

async function settle(hook: AudioRouteHook): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  render(hook);
}

const source: RecordingInput = { uid: "41", name: "AirPods Pro", type: "BluetoothSCO" };
const sink = { uid: "42", name: "AirPods Pro", type: "Bluetooth" };

beforeEach(() => {
  native.bridgeAvailable = true;
  native.recorderInputs = [];
  native.recorderCurrent = null;
  native.sinks = [];
  native.bridgeCurrent = null;
  native.setInput.mockReset();
  native.setCommunication.mockReset();
  native.setCommunication.mockReturnValue(true);
  native.clear.mockReset();
  native.clear.mockReturnValue(true);
  hooks.cells = [];
  hooks.cleanups = [];
  hooks.changed = false;
});

describe("useAudioRoute Android endpoint domain", () => {
  it("lists and selects communication sinks, never recorder source ids", async () => {
    native.recorderInputs = [source];
    native.sinks = [sink];
    native.bridgeCurrent = sink;
    native.setCommunication.mockImplementation((uid) => uid === "42");
    const { useAudioRoute: hook } = await loadHook();
    render(hook);
    await settle(hook);

    expect(latest.inputs.map((input) => input.uid)).toEqual(["42"]);
    expect(latest.activeUid).toBe("42");
    expect(latest.error).toBeUndefined();

    expect(latest.apply({ route: "bluetooth", uid: "42" })).toBeUndefined();
    expect(native.setCommunication).toHaveBeenCalledWith("42");
    expect(native.setCommunication).not.toHaveBeenCalledWith("41");
    expect(native.setInput).not.toHaveBeenCalled();
  });

  it("falls back to the recorder on legacy Android despite module presence", async () => {
    native.bridgeAvailable = false;
    native.recorderInputs = [source];
    const { useAudioRoute: hook } = await loadHook();
    render(hook);
    await settle(hook);

    expect(latest.inputs.map((input) => input.uid)).toEqual(["41"]);
    // Legacy cannot verify the active call route, so it stays unknown.
    expect(latest.activeUid).toBeUndefined();

    expect(latest.apply({ route: "bluetooth" })).toBeUndefined();
    expect(native.setInput).toHaveBeenCalledWith("41");
    expect(native.setCommunication).not.toHaveBeenCalled();
  });

  it("accepts a successful system-default clear", async () => {
    native.bridgeCurrent = sink;
    const { useAudioRoute: hook } = await loadHook();
    render(hook);
    await settle(hook);

    expect(latest.apply({ route: "system" })).toBeUndefined();
    expect(native.clear).toHaveBeenCalledTimes(1);
    render(hook);
    expect(latest.error).toBeUndefined();
    expect(latest.activeUid).toBeUndefined();
  });

  it("retries a saved sink until a delayed enumeration lists it", async () => {
    native.bridgeAvailable = true;
    native.sinks = [];
    const { useAudioRoute: hook } = await loadHook();
    render(hook);
    await settle(hook);

    expect(latest.applySaved("native:42", null, [])).toEqual({ status: "pending" });

    native.sinks = [sink];
    native.bridgeCurrent = sink;
    latest.refresh();
    await settle(hook);
    expect(latest.inputs.map((input) => input.uid)).toEqual(["42"]);
    expect(latest.applySaved("native:42", null, [])).toEqual({ status: "applied" });
    expect(native.setCommunication).toHaveBeenCalledWith("42");
  });
});
