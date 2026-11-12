import { type RecordingInput, RecordingPresets, useAudioRecorder } from "expo-audio";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { bluetoothInputName, inputForRoute, type MediaDeviceRoute } from "./media-device-choices";

export interface AudioRoute {
  /** The connected Bluetooth headset, when the platform exposes its route. */
  readonly name: string | undefined;
  readonly refresh: () => void;
  /**
   * Switches the platform's communication route. Returns false when this build
   * or OS version cannot select an input (Android 8 and older, web, a missing
   * native module); the OS route still applies in that case.
   */
  readonly apply: (_route: MediaDeviceRoute) => boolean;
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
 * capture side effect.
 */
export function useAudioRoute(): AudioRoute {
  const recorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const [inputs, setInputs] = useState<readonly RecordingInput[]>([]);

  const refresh = useCallback(() => {
    try {
      setInputs(recorder.getAvailableInputs());
    } catch {
      // The native route list is unavailable on this build; devices still show
      // through the WebRTC picker.
      setInputs([]);
    }
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

  const apply = useCallback(
    (route: MediaDeviceRoute) => {
      const target = inputForRoute(inputs, route);
      if (target === undefined) return false;
      try {
        recorder.setInput(target.uid);
        return true;
      } catch {
        return false;
      }
    },
    [inputs, recorder],
  );

  return { name: bluetoothInputName(inputs), refresh, apply };
}
