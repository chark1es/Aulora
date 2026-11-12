/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { requireOptionalNativeModule } from "expo";

/**
 * The actual platform communication route used by a call.
 *
 * Android's `AudioManager` is the source of truth while a call is in
 * communication mode. `expo-audio`'s recorder API only reports a recorder
 * device, which is a different (and unprepared) object on Android, so it cannot
 * answer what the call is using. This module is Android-only; iOS already
 * reports the real `AVAudioSession` route through `expo-audio`.
 */
export interface NativeCommunicationDevice {
  readonly uid: string;
  readonly name: string;
  readonly type: string;
}

interface NativeAudioRoute {
  getCommunicationDevice(): NativeCommunicationDevice | null;
  /** Returns the platform's Boolean result, not merely "did not throw". */
  setCommunicationDevice(uid: string): boolean;
  clearCommunicationDevice(): boolean;
}

const native = requireOptionalNativeModule<NativeAudioRoute>("AuloraAudioRoute");

/** Whether this build can read and verify the Android communication route. */
export const communicationRouteAvailable: boolean = native !== null;

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
 * Selects a communication input. Returns `null` when this build has no bridge
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
