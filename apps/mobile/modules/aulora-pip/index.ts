/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { requireOptionalNativeModule } from "expo";

/**
 * Android picture-in-picture for a video call. A thin, safe wrapper over the
 * native module: where the module is absent (iOS, web, an older build) every
 * call is a no-op, so callers never need to branch on the platform themselves.
 */
interface PipChangeEvent {
  readonly active: boolean;
}

interface NativePip {
  isSupported(): boolean;
  setEnabled(enabled: boolean): void;
  enter(): boolean;
  expand(): void;
  isActive(): boolean;
  addListener(
    event: "onPipChange",
    listener: (event: PipChangeEvent) => void,
  ): {
    remove(): void;
  };
}

const native = requireOptionalNativeModule<NativePip>("AuloraPip");

export function pictureInPictureSupported(): boolean {
  return native?.isSupported() === true;
}

/** Lets the system float the app when the user leaves it (or stops that). */
export function setPictureInPictureEnabled(enabled: boolean): void {
  native?.setEnabled(enabled);
}

/** Floats the app now; `false` when it could not. */
export function enterPictureInPicture(): boolean {
  return native?.enter() === true;
}

/** Brings the app back to full screen from the floating window. */
export function exitPictureInPicture(): void {
  native?.expand();
}

export function pictureInPictureActive(): boolean {
  return native?.isActive() === true;
}

/** Calls `listener` whenever the app enters or leaves the floating window. */
export function onPictureInPictureChange(listener: (active: boolean) => void): () => void {
  if (native === null) {
    return () => {
      // No native module, so there is no subscription to remove.
    };
  }
  const subscription = native.addListener("onPipChange", (event) => {
    listener(event.active);
  });
  return () => {
    subscription.remove();
  };
}
