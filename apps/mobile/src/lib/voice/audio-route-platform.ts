import type { MediaDeviceInfo } from "@aulora/core";
import type { RecordingInput } from "expo-audio";
import { inputForRoute, type MediaDeviceRoute, savedRouteTarget } from "./media-device-choices";

export interface AudioRouteTarget {
  readonly route: MediaDeviceRoute;
  /** A `native:` row's uid, applied directly instead of by route class. */
  readonly uid?: string | undefined;
}

/** How applying a saved route ended, so a call can retry without latching a no-op. */
export type SavedRouteStatus = "applied" | "pending" | "failed" | "none";

export interface SavedRouteResult {
  readonly status: SavedRouteStatus;
  /** A platform error, retained so the call entry can report it. */
  readonly message?: string;
}

/**
 * The seam the hook uses to read and change Android's real call route.
 *
 * Everything here is in the communication-*sink* domain: `list()` enumerates
 * `AudioManager.getAvailableCommunicationDevices()` and `get()`/`set()` use the
 * same ids. A recorder input id from `GET_DEVICES_INPUTS` is a different
 * endpoint and must never be passed to `set()`.
 */
export interface CommunicationRoute {
  readonly available: boolean;
  list(): readonly NativeCommunicationDevice[];
  get(): NativeCommunicationDevice | null;
  set(_uid: string): boolean | null;
  clear(): boolean | null;
}

/** The device shape the Android bridge reports. */
export interface NativeCommunicationDevice {
  readonly uid: string;
  readonly name: string;
  readonly type: string;
}

/** A recorder-like object: iOS returns synchronously, Android asynchronously. */
export interface CurrentInputSource {
  getCurrentInput(): Promise<RecordingInput> | RecordingInput;
}

/** The Android system route expressed in expo-audio's input shape. */
export function routeInputFromCommunicationDevice(
  device: NativeCommunicationDevice,
): RecordingInput {
  return { uid: device.uid, name: device.name, type: device.type };
}

/**
 * Reads the route the call is actually using.
 *
 * - Android must use `AudioManager`'s communication device. The recorder's
 *   `getCurrentInput` is not that route: the recorder is never prepared, so the
 *   SDK falls back to (and writes) the built-in microphone, which would relabel
 *   a live Bluetooth call as built-in on every poll. Without the bridge the
 *   active route is unknown rather than wrong.
 * - iOS `getCurrentInput` reads `AVAudioSession.currentRoute` (preferred input
 *   as a fallback). It is a *synchronous* native function despite the
 *   TypeScript Promise declaration, so the value is awaited inside this guarded
 *   async path. A synchronous throw or a rejected Promise both reject here for
 *   the caller to contain.
 */
const NO_COMMUNICATION_ROUTE: CommunicationRoute = {
  available: false,
  list: () => [],
  get: () => null,
  set: () => null,
  clear: () => null,
};

export async function readPlatformCurrentInput(
  recorder: CurrentInputSource,
  platform: string,
  route: CommunicationRoute = NO_COMMUNICATION_ROUTE,
): Promise<RecordingInput | null> {
  if (platform === "android") {
    if (!route.available) {
      return null;
    }
    const device = route.get();
    return device === null ? null : routeInputFromCommunicationDevice(device);
  }
  return await recorder.getCurrentInput();
}

/** A synchronous iOS confirmation; a Promise or a throw means "not confirmed". */
export function confirmInputNow(recorder: CurrentInputSource): RecordingInput | null {
  try {
    const value = recorder.getCurrentInput() as unknown;
    if (
      typeof value === "object" &&
      value !== null &&
      "then" in value &&
      typeof (value as { then?: unknown }).then === "function"
    ) {
      return null;
    }
    return value as RecordingInput;
  } catch {
    return null;
  }
}

/** A recorder that can both report and request its native input. */
export interface AudioRouteSwitcher extends CurrentInputSource {
  setInput(_uid: string): void;
}

/**
 * Sets an Android communication sink, then verifies the system readback before
 * the UI may call that input current.
 */
function selectAndroidCommunicationInput(
  uid: string,
  bridge: CommunicationRoute,
  setActiveUid: (_uid: string | undefined) => void,
): string | undefined {
  if (bridge.set(uid) !== true) {
    return "The system rejected the audio route switch.";
  }
  const confirmed = bridge.get();
  if (confirmed?.uid !== uid) {
    return "The system did not confirm the audio route switch.";
  }
  setActiveUid(uid);
  return undefined;
}

function selectRecorderInput(
  uid: string,
  android: boolean,
  recorder: AudioRouteSwitcher,
  setActiveUid: (_uid: string | undefined) => void,
): string | undefined {
  try {
    recorder.setInput(uid);
    // Legacy Android cannot verify the call route; iOS confirms synchronously.
    setActiveUid(android ? undefined : confirmInputNow(recorder)?.uid);
    return undefined;
  } catch {
    return "The system rejected the audio route switch.";
  }
}

/**
 * Requests one route and reports the platform's active input, or the message
 * to show when the switch failed.
 *
 * Android with the bridge routes in the communication-sink domain: `set()`
 * discards the SDK's Boolean result, so the system route is read back before
 * the UI may call this input current. Legacy Android has no bridge and cannot
 * verify the call route, so it requests the recorder input and leaves the
 * active route unknown. iOS reads its synchronous confirmation immediately.
 * `setActiveUid` is only called when the active route is known or explicitly
 * cleared; failures leave the previous value in place.
 */
export function selectAudioRoute(
  target: AudioRouteTarget,
  inputs: readonly RecordingInput[],
  platform: string,
  bridge: CommunicationRoute,
  recorder: AudioRouteSwitcher,
  setActiveUid: (_uid: string | undefined) => void,
): string | undefined {
  const input =
    target.uid !== undefined
      ? inputs.find((entry) => entry.uid === target.uid)
      : inputForRoute(inputs, target.route);
  const android = platform === "android";
  const systemDefault = target.route === "system" && target.uid === undefined;
  // "System default" means release our pinned communication device and let
  // Android choose. Other routes resolve to a concrete platform input.
  if (android && bridge.available && systemDefault) {
    if (bridge.clear() !== true) {
      return "The system rejected the audio route change.";
    }
    setActiveUid(undefined);
    return undefined;
  }
  if (input === undefined) {
    // An unset system default has nothing to pin, so it is not an error.
    return systemDefault ? undefined : "This device cannot switch to that audio route.";
  }
  if (android && bridge.available) {
    return selectAndroidCommunicationInput(input.uid, bridge, setActiveUid);
  }
  return selectRecorderInput(input.uid, android, recorder, setActiveUid);
}

/**
 * Applies the saved output then input choice through the platform route.
 *
 * A selected id that is not in the current enumeration is `pending`, not a
 * successful no-op: a headset can appear after the call starts, and call entry
 * must retry rather than permanently latch the first attempt.
 */
export function applySavedRoute(
  inputs: readonly RecordingInput[],
  devices: readonly MediaDeviceInfo[],
  inputId: string | null,
  outputId: string | null,
  apply: (_target: AudioRouteTarget) => string | undefined,
): SavedRouteResult {
  // Prefer the saved output route; fall back to the microphone choice when the
  // output is not enumerated (the platform input row still moves both).
  const outputTarget = savedRouteTarget(inputs, devices, "audiooutput", outputId);
  if (outputTarget !== undefined) {
    const message = apply(outputTarget);
    return message === undefined ? { status: "applied" } : { status: "failed", message };
  }
  const inputTarget = savedRouteTarget(inputs, devices, "audioinput", inputId);
  if (inputTarget !== undefined) {
    const message = apply(inputTarget);
    return message === undefined ? { status: "applied" } : { status: "failed", message };
  }
  if (outputId !== null || inputId !== null) {
    return { status: "pending" };
  }
  return { status: "none" };
}

/** What happened to the saved route for one call/settings combination. */
export interface SavedRouteProgress {
  /** The signature whose route was successfully applied (or had nothing to do). */
  readonly appliedSignature: string | null;
  /** The last failed signature already surfaced to the person. */
  readonly reportedFailureSignature: string | null;
}

export const NO_SAVED_ROUTE_PROGRESS: SavedRouteProgress = {
  appliedSignature: null,
  reportedFailureSignature: null,
};

export function savedRouteSignature(
  callId: string,
  inputId: string | null,
  outputId: string | null,
): string {
  return `${callId}|${inputId ?? ""}|${outputId ?? ""}`;
}

/**
 * Folds one attempt into the call's route progress.
 *
 * Only a successful (or empty) application latches, so a pending delayed route
 * and a rejected switch are retried when the route list or settings change. A
 * failure is reported once per signature; the quiet retries continue.
 */
export function recordSavedRouteAttempt(
  progress: SavedRouteProgress,
  signature: string,
  result: SavedRouteResult,
): { readonly progress: SavedRouteProgress; readonly shouldReport: boolean } {
  if (result.status === "applied" || result.status === "none") {
    return {
      progress: { appliedSignature: signature, reportedFailureSignature: null },
      shouldReport: false,
    };
  }
  if (result.status === "failed" && progress.reportedFailureSignature !== signature) {
    return {
      progress: { ...progress, reportedFailureSignature: signature },
      shouldReport: true,
    };
  }
  return { progress, shouldReport: false };
}
