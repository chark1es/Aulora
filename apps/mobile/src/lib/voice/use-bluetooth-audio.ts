import { RecordingPresets, useAudioRecorder } from "expo-audio";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { bluetoothInputName } from "./media-device-choices";

export interface BluetoothAudioRoute {
  readonly name: string | undefined;
  readonly refresh: () => void;
}

/**
 * The name of the connected Bluetooth audio input, when the platform exposes
 * it. This uses the recorder's route list rather than the WebRTC device list:
 * iOS does not enumerate Bluetooth outputs over WebRTC, and Android reports
 * Bluetooth SCO inputs there only after permission has been granted.
 *
 * The recorder is never prepared or started; asking for its available inputs
 * has no capture side effect.
 */
export function useBluetoothAudioName(): BluetoothAudioRoute {
  const recorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const [name, setName] = useState<string | undefined>(undefined);
  const refresh = useCallback(() => {
    try {
      setName(bluetoothInputName(recorder.getAvailableInputs()));
    } catch {
      // The native route list is unavailable on this build; devices still show
      // through the WebRTC picker.
      setName(undefined);
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

  return { name, refresh };
}
