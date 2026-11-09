import { lazy, Suspense, useSyncExternalStore } from "react";
import {
  getDisplayPickerState,
  subscribeDisplayPicker,
} from "../../lib/voice/display-picker-store";

// The picker dialog is only drawn while a screen share is being started, and a
// browser build never opens it at all. Mounting the real component on demand
// keeps it out of the entry chunk that every page load downloads.
const DisplaySourcePicker = lazy(() =>
  import("./DisplaySourcePicker").then((module) => ({ default: module.DisplaySourcePicker })),
);

function pickerIdle(): boolean {
  return getDisplayPickerState().status === "idle";
}

/**
 * Renders {@link DisplaySourcePicker} once a share flow opens it, and nothing
 * before that. The subscription itself is tiny because the call code already
 * drives the same store.
 */
export function DisplaySourcePickerGate() {
  const idle = useSyncExternalStore(subscribeDisplayPicker, pickerIdle, pickerIdle);
  if (idle) {
    return null;
  }
  return (
    <Suspense fallback={null}>
      <DisplaySourcePicker />
    </Suspense>
  );
}
