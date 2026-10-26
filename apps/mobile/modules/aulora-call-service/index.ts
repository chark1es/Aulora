import { requireOptionalNativeModule } from "expo";

/**
 * Android foreground service that keeps a call's microphone and camera
 * available after the user leaves the app.
 *
 * A thin, safe wrapper over the native module: where the module is absent
 * (iOS, web, an older build) every call is a no-op, so callers never branch on
 * the platform. iOS needs no equivalent — the system keeps call audio alive and
 * the video PiP path keeps the camera watched.
 */
interface NativeCallService {
  update(microphone: boolean, camera: boolean): void;
  stop(): void;
}

const native = requireOptionalNativeModule<NativeCallService>("AuloraCallService");

/** The capture a call currently holds, which decides the service's types. */
export interface CallCapture {
  readonly microphone: boolean;
  readonly camera: boolean;
}

/**
 * Runs the foreground service for `capture`, or stops it when the call holds
 * neither. Safe to call repeatedly; each call replaces the running service's
 * declared types.
 */
export function syncCallService(capture: CallCapture): void {
  if (native === null) {
    return;
  }
  if (capture.microphone || capture.camera) {
    native.update(capture.microphone, capture.camera);
  } else {
    native.stop();
  }
}
