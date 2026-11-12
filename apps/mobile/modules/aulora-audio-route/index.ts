/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { requireOptionalNativeModule } from "expo";

/**
 * The actual platform communication route used by a call.
 *
 * Android's `AudioManager` is the source of truth while a call is in
 * communication mode. `expo-audio`'s recorder API only reports a recorder
 * device, which is a different (and unprepared) object on Android, so it cannot
 * answer what the call is using. `AudioManager.setCommunicationDevice` also
 * requires a *communication sink* from `getAvailableCommunicationDevices()`,
 * never a recorder input from `GET_DEVICES_INPUTS`; the two endpoints have
 * different ids. This module is Android-only; iOS already reports the real
 * `AVAudioSession` route through `expo-audio`.
 */
export interface NativeCommunicationDevice {
  readonly uid: string;
  readonly name: string;
  readonly type: string;
}

interface NativeAudioRoute {
  /** Whether the OS exposes the communication-device API (Android 12+). */
  isSupported(): boolean;
  /** Selectable communication sinks, each with its own native id. */
  getAvailableCommunicationDevices(): NativeCommunicationDevice[];
  getCommunicationDevice(): NativeCommunicationDevice | null;
  /** Returns the platform's Boolean result, not merely "did not throw". */
  setCommunicationDevice(uid: string): boolean;
  clearCommunicationDevice(): boolean;
}

const native = requireOptionalNativeModule<NativeAudioRoute>("AuloraAudioRoute");

function moduleSupportsCommunicationDevice(): boolean {
  if (native === null) {
    return false;
  }
  try {
    return native.isSupported() === true;
  } catch {
    // An older module build has no capability probe. Do not claim the feature
    // exists merely because the module is present; let the legacy path run.
    return false;
  }
}

/**
 * Whether this build can read, enumerate and verify the Android communication
 * route. This is the OS capability, not module presence: an installed module on
 * Android 9-11 cannot use the communication-device API, so callers must keep
 * the expo-audio legacy fallback.
 */
export const communicationRouteAvailable: boolean = moduleSupportsCommunicationDevice();

/**
 * The selectable communication sinks (not recorder inputs). Empty when this
 * build or OS version cannot enumerate them.
 */
export function getAvailableCommunicationDevices(): NativeCommunicationDevice[] {
  if (!communicationRouteAvailable || native === null) {
    return [];
  }
  try {
    return native.getAvailableCommunicationDevices();
  } catch {
    return [];
  }
}

/** The live communication device, or `null` when the platform cannot report one. */
export function getCommunicationDevice(): NativeCommunicationDevice | null {
  if (native === null) {
    return null;
  }
  try {
    return native.getCommunicationDevice();
  } catch {
    return null;
  }
}

/**
 * Selects a communication sink. Returns `null` when this build has no bridge
 * (where callers must treat the route as unverified), otherwise the platform's
 * Boolean acceptance.
 */
export function setCommunicationDevice(uid: string): boolean | null {
  if (native === null) {
    return null;
  }
  try {
    return native.setCommunicationDevice(uid);
  } catch {
    return false;
  }
}

/** Returns to the platform default route. `null` means the bridge is absent. */
export function clearCommunicationDevice(): boolean | null {
  if (native === null) {
    return null;
  }
  try {
    return native.clearCommunicationDevice();
  } catch {
    return false;
  }
}
