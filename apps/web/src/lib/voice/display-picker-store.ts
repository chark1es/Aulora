/**
 * The picker's observable state, kept apart from the flow that loads tiles.
 *
 * The router mounts a gate that subscribes to this store to decide whether the
 * picker is open. Sharing the store with `display-picker.ts` (rather than the
 * whole flow, which reaches into the desktop capture bridge) keeps that gate
 * tiny and the screen-capture machinery out of the entry chunk.
 */

import type { DisplayPickerState } from "./display-picker";

/** Every field at its resting value: the picker is closed. */
export const IDLE_DISPLAY_PICKER: DisplayPickerState = {
  status: "idle",
  sources: [],
  error: null,
  selectedId: null,
  audioRequested: false,
  audio: null,
  permission: null,
};

let state: DisplayPickerState = IDLE_DISPLAY_PICKER;
const listeners = new Set<() => void>();

/** The current picker state; read it through `useSyncExternalStore`. */
export function getDisplayPickerState(): DisplayPickerState {
  return state;
}

/** Notifies subscribers whenever the picker state changes. */
export function subscribeDisplayPicker(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Replaces the picker state and wakes every subscriber. */
export function setDisplayPickerState(next: DisplayPickerState): void {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}
