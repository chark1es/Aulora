import type { MediaDeviceInfo } from "@aulora/core";
import { type RecordingInput, RecordingPresets, useAudioRecorder } from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  bluetoothInputName,
  inputForRoute,
  type MediaDeviceRoute,
  type NativeRouteList,
  savedRouteTarget,
} from "./media-device-choices";

/** How often the platform route list is re-read while a surface listens to it. */
const ROUTE_POLL_MS = 2_000;

export interface AudioRouteTarget {
  readonly route: MediaDeviceRoute;
  /** A `native:` row's uid, applied directly instead of by route class. */
  readonly uid?: string | undefined;
}

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
   * this build or OS version cannot select an input (Android 9 and older, web,
   * a missing native module); `undefined` means the switch was applied.
   */
  readonly apply: (_target: AudioRouteTarget) => string | undefined;
  /** Re-applies the saved input/output choices, e.g. when a call starts. */
  readonly applySaved: (
    _inputId: string | null,
    _outputId: string | null,
    _devices: readonly MediaDeviceInfo[],
  ) => boolean;
}

/**
 * Reads and switches the native capture route.
 *
 * The recorder's route list is used rather than the WebRTC device list: iOS
 * does not enumerate Bluetooth outputs over WebRTC, and Android only reports
 * Bluetooth SCO inputs there after permission has been granted. Selecting a
 * route here is what actually moves call audio: iOS sets the preferred input
 * (the port carries both directions), and Android sets the communication
 * device, so a Bluetooth headset both records and plays through the headset.
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

  const refresh = useCallback(() => {
    try {
      const next = recorder.getAvailableInputs();
      inputsRef.current = next;
      setInputs(next);
    } catch {
      // The native route list is unavailable on this build; devices still show
      // through the WebRTC picker.
      inputsRef.current = [];
      setInputs([]);
    }
    void recorder
      .getCurrentInput()
      .then((input) => {
        activeRef.current = input.uid;
        setActiveUid(input.uid);
      })
      .catch(() => {
        // Availability is still useful even when the active route is unknown.
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
      const input =
        target.uid !== undefined
          ? inputsRef.current.find((entry) => entry.uid === target.uid)
          : inputForRoute(inputsRef.current, target.route);
      if (input === undefined) {
        const message =
          target.route === "system" && target.uid === undefined
            ? undefined
            : "This device cannot switch to that audio route.";
        setError(message);
        return message;
      }
      try {
        recorder.setInput(input.uid);
        // setInput is synchronous on the native bridge, so reflect the choice
        // immediately instead of waiting for the next poll.
        activeRef.current = input.uid;
        setActiveUid(input.uid);
        setError(undefined);
        return undefined;
      } catch {
        const message = "The system rejected the audio route switch.";
        setError(message);
        return message;
      }
    },
    [recorder],
  );

  const apply = useCallback((target: AudioRouteTarget) => setRoute(target), [setRoute]);

  const applySaved = useCallback(
    (inputId: string | null, outputId: string | null, devices: readonly MediaDeviceInfo[]) => {
      // The recorder's input switch moves the shared session for capture and
      // playback. Prefer the output choice when one is saved (it is what the
      // person hears), then fall back to the microphone choice.
      const outputTarget = savedRouteTarget(inputsRef.current, devices, "audiooutput", outputId);
      if (outputTarget !== undefined) return setRoute(outputTarget) === undefined;
      const inputTarget = savedRouteTarget(inputsRef.current, devices, "audioinput", inputId);
      return inputTarget === undefined || setRoute(inputTarget) === undefined;
    },
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
