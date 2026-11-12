import type { MediaDeviceInfo } from "@aulora/core";
import { type RecordingInput, RecordingPresets, useAudioRecorder } from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import {
  clearCommunicationDevice,
  communicationRouteAvailable,
  getAvailableCommunicationDevices,
  getCommunicationDevice,
  setCommunicationDevice,
} from "../../../modules/aulora-audio-route";
import {
  type AudioRouteTarget,
  applySavedRoute,
  type CommunicationRoute,
  readPlatformCurrentInput,
  routeInputFromCommunicationDevice,
  type SavedRouteResult,
  selectAudioRoute,
} from "./audio-route-platform";
import { bluetoothInputName, type NativeRouteList } from "./media-device-choices";

export type {
  AudioRouteTarget,
  SavedRouteResult,
  SavedRouteStatus,
} from "./audio-route-platform";

/** How often the platform route list is re-read while a surface listens to it. */
const ROUTE_POLL_MS = 2_000;

export interface AudioRoute extends NativeRouteList {
  /** The connected Bluetooth input, if the platform lists one. */
  readonly name: string | undefined;
  /** Why the last route switch failed, so the UI can report it. */
  readonly error: string | undefined;
  readonly refresh: () => void;
  /** Requests live route polling while a surface needs it; returns a release. */
  readonly watch: () => () => void;
  /**
   * Switches the platform's communication route. Returns an error message when
   * this build or OS version cannot select or verify an input; `undefined`
   * means the platform accepted the switch.
   */
  readonly apply: (_target: AudioRouteTarget) => string | undefined;
  /**
   * Re-applies the saved input/output choices, e.g. when a call starts. A
   * `pending` result means the saved route is not enumerated yet and must be
   * retried; `failed` carries the platform message.
   */
  readonly applySaved: (
    _inputId: string | null,
    _outputId: string | null,
    _devices: readonly MediaDeviceInfo[],
  ) => SavedRouteResult;
}

export const platformCommunicationRoute: CommunicationRoute = {
  available: communicationRouteAvailable,
  list: getAvailableCommunicationDevices,
  get: getCommunicationDevice,
  set: setCommunicationDevice,
  clear: clearCommunicationDevice,
};

/**
 * Reads and switches the native capture route.
 *
 * The platform's communication route is used rather than the WebRTC device
 * list: iOS does not enumerate Bluetooth outputs over WebRTC, and Android only
 * reports Bluetooth SCO inputs there after permission has been granted.
 * Selecting a route here is what actually moves call audio: iOS sets the
 * preferred input (the port carries both directions), and Android sets the
 * communication device, so a Bluetooth headset both records and plays through
 * the headset.
 *
 * The recorder is never prepared or started, so opening settings has no
 * capture side effect. expo-audio only exposes a snapshot list, not a route
 * change event, so the list is re-read on foreground and on a short interval
 * while this hook is mounted; available and active routes stay separate.
 */
export function useAudioRoute(): AudioRoute {
  const recorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const [inputs, setInputs] = useState<readonly RecordingInput[]>([]);
  const [activeUid, setActiveUid] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [watchers, setWatchers] = useState(0);
  const inputsRef = useRef<readonly RecordingInput[]>([]);
  inputsRef.current = inputs;
  const activeRef = useRef<string | undefined>(undefined);
  activeRef.current = activeUid;
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const refresh = useCallback(() => {
    let next: readonly RecordingInput[] = [];
    try {
      // Android's communication route is a *sink* list. Recorder inputs are a
      // different endpoint domain (their ids cannot be passed to
      // setCommunicationDevice), so enumerate the sinks the platform accepts
      // whenever the capability exists. iOS and legacy Android keep the
      // recorder inputs, which are their real selectable routes.
      next =
        Platform.OS === "android" && platformCommunicationRoute.available
          ? platformCommunicationRoute.list().map(routeInputFromCommunicationDevice)
          : recorder.getAvailableInputs();
    } catch {
      // The native route list is unavailable on this build; devices still show
      // through the WebRTC picker.
      next = [];
    }
    inputsRef.current = next;
    setInputs(next);
    void readPlatformCurrentInput(recorder, Platform.OS, platformCommunicationRoute)
      .then((input) => {
        if (!mounted.current) {
          return;
        }
        // An unknown live route is left unset instead of reusing the recorder's
        // built-in fallback as if it were the call's route.
        activeRef.current = input?.uid;
        setActiveUid(input?.uid);
      })
      .catch(() => {
        if (!mounted.current) {
          return;
        }
        activeRef.current = undefined;
        setActiveUid(undefined);
      });
  }, [recorder]);

  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      subscription.remove();
    };
  }, [refresh]);

  // No native "route changed" event exists, so poll only while a surface asks
  // for live updates (settings open, or a call running). The provider itself
  // stays mounted for the whole session and must not poll forever.
  useEffect(() => {
    if (watchers <= 0) return;
    const timer = setInterval(refresh, ROUTE_POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [refresh, watchers]);

  const watch = useCallback(() => {
    setWatchers((count) => count + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setWatchers((count) => Math.max(0, count - 1));
    };
  }, []);

  const setRoute = useCallback(
    (target: AudioRouteTarget): string | undefined => {
      const message = selectAudioRoute(
        target,
        inputsRef.current,
        Platform.OS,
        platformCommunicationRoute,
        recorder,
        (uid) => {
          activeRef.current = uid;
          setActiveUid(uid);
        },
      );
      setError(message);
      return message;
    },
    [recorder],
  );

  const apply = useCallback((target: AudioRouteTarget) => setRoute(target), [setRoute]);

  const applySaved = useCallback(
    (inputId: string | null, outputId: string | null, devices: readonly MediaDeviceInfo[]) =>
      applySavedRoute(inputsRef.current, devices, inputId, outputId, setRoute),
    [setRoute],
  );

  return {
    inputs,
    activeUid,
    name: bluetoothInputName(inputs),
    error,
    refresh,
    watch,
    apply,
    applySaved,
  };
}
