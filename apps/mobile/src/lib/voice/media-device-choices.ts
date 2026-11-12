import type { MediaDeviceInfo } from "@aulora/core";

/** The sentinel the pickers use for "follow the device's own route". */
export const SYSTEM_DEFAULT_DEVICE = "__system_default__";

/** One row in a device dropdown. */
export interface MediaDeviceChoice {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
}

/**
 * Labels platforms give Bluetooth audio devices. iOS uses the product name
 * ("AirPods Pro"), while Android often says "Bluetooth headset"; neither
 * exposes a portable device-type field through the WebRTC device list, so the
 * label is the only signal available when the platform route API is absent.
 */
const BLUETOOTH_LABEL =
  /bluetooth|airpods|beats|bose|jabra|galaxy buds|pixel buds|wh-1000|wf-1000|soundcore|skullcandy/i;

export function looksLikeBluetooth(label: string): boolean {
  return BLUETOOTH_LABEL.test(label);
}

/** Whether a platform recording-input type is a Bluetooth route. */
export function isBluetoothInputType(type: string): boolean {
  return /bluetooth/i.test(type);
}

/** The name of the first connected Bluetooth input, if one is available. */
export function bluetoothInputName(
  inputs: readonly { readonly type: string; readonly name: string }[],
): string | undefined {
  return inputs.find((input) => isBluetoothInputType(input.type))?.name;
}

/**
 * The choices for one device kind. "System default" always comes first and
 * carries the detected Bluetooth route as its hint, so the current audio
 * source is visible without opening the picker.
 */
export function deviceChoices(
  devices: readonly MediaDeviceInfo[],
  kind: MediaDeviceInfo["kind"],
  bluetoothName?: string,
): MediaDeviceChoice[] {
  const options = devices.filter((device) => device.kind === kind);
  return [
    {
      id: SYSTEM_DEFAULT_DEVICE,
      label: "System default",
      hint:
        bluetoothName === undefined
          ? "Follows this device's audio route"
          : `Bluetooth · ${bluetoothName}`,
    },
    ...options.map((device) => ({
      id: device.deviceId,
      label: device.label,
      ...(looksLikeBluetooth(device.label) ? { hint: "Bluetooth" } : {}),
    })),
  ];
}

/** The label for the device the settings currently point at. */
export function selectedDeviceLabel(
  devices: readonly MediaDeviceInfo[],
  kind: MediaDeviceInfo["kind"],
  selectedId: string | null,
): string {
  if (selectedId === null) return "System default";
  return (
    devices.find((device) => device.kind === kind && device.deviceId === selectedId)?.label ??
    "System default"
  );
}

/**
 * Drops a saved device id once that device is gone. Without this, a
 * disconnected Bluetooth headset would keep sending an exact `deviceId`
 * constraint the platform can no longer satisfy, and the next call would fail
 * to capture instead of falling back to the built-in microphone.
 */
export function reconcileDeviceId(
  devices: readonly MediaDeviceInfo[],
  kind: MediaDeviceInfo["kind"],
  selectedId: string | null,
): string | null {
  if (selectedId === null) return null;
  return devices.some((device) => device.kind === kind && device.deviceId === selectedId)
    ? selectedId
    : null;
}
