import type { MediaDeviceInfo } from "@aulora/core";
import type { RecordingInput } from "expo-audio";

/** The sentinel the pickers use for "follow the device's own route". */
export const SYSTEM_DEFAULT_DEVICE = "__system_default__";

/**
 * How a choice reaches the person. `system` follows the OS route, `bluetooth`
 * is a headset the platform can switch to, and `device` is a specific
 * non-Bluetooth WebRTC device the call engine selects at capture time.
 */
export type MediaDeviceRoute = "system" | "device" | "bluetooth";

/** One row in a device dropdown. */
export interface MediaDeviceChoice {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly route: MediaDeviceRoute;
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

/** The routing class of one concrete device, from what the platform exposes. */
export function classifyRoute(label: string): MediaDeviceRoute {
  return looksLikeBluetooth(label) ? "bluetooth" : "device";
}

/** The name of the first connected Bluetooth input, if one is available. */
export function bluetoothInputName(
  inputs: readonly { readonly type: string; readonly name: string }[],
): string | undefined {
  return inputs.find((input) => isBluetoothInputType(input.type))?.name;
}

/** The native input a route selects, or `undefined` when it cannot be mapped. */
export function inputForRoute(
  inputs: readonly RecordingInput[],
  route: MediaDeviceRoute,
): RecordingInput | undefined {
  if (route === "device") return undefined;
  const usable = inputs.filter((input) => !isBluetoothInputType(input.type));
  if (route === "bluetooth") {
    return inputs.find((input) => isBluetoothInputType(input.type));
  }
  return usable.find((input) => /built.?in|internal/i.test(input.type)) ?? usable[0];
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
      route: "system",
    },
    ...options.map((device) => {
      const route = classifyRoute(device.label);
      return {
        id: device.deviceId,
        label: device.label,
        ...(route === "bluetooth" ? { hint: "Bluetooth" } : {}),
        route,
      };
    }),
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

/** The routing class of the saved choice, used to show a Bluetooth hint. */
export function selectedDeviceRoute(
  devices: readonly MediaDeviceInfo[],
  kind: MediaDeviceInfo["kind"],
  selectedId: string | null,
): MediaDeviceRoute {
  if (selectedId === null) return "system";
  const device = devices.find((entry) => entry.kind === kind && entry.deviceId === selectedId);
  return device === undefined ? "system" : classifyRoute(device.label);
}

/** How many consecutive incomplete passes each saved device has been missing. */
export interface DeviceAbsence {
  readonly input: number;
  readonly output: number;
  readonly camera: number;
}

export const NO_DEVICE_ABSENCE: DeviceAbsence = { input: 0, output: 0, camera: 0 };

/** A saved device must be missing this many enumerations before it is cleared. */
export const DEVICE_ABSENT_PASS_LIMIT = 2;

interface DeviceSettingsIds {
  readonly inputDeviceId: string | null;
  readonly outputDeviceId: string | null;
  readonly cameraDeviceId: string | null;
}

export interface DeviceReconciliation extends DeviceSettingsIds {
  readonly absence: DeviceAbsence;
}

/**
 * A first enumeration can be partial: the microphone permission may not have
 * been answered yet, and a Bluetooth headset reconnects a moment after the app
 * comes forward. Clearing on the first pass would silently discard a choice the
 * person made on purpose, so a device is only dropped after it has been missing
 * from {@link DEVICE_ABSENT_PASS_LIMIT} consecutive informative passes. A pass
 * with no devices of that kind is not informative and changes nothing.
 */
function reconcileKind(
  devices: readonly MediaDeviceInfo[],
  kind: MediaDeviceInfo["kind"],
  selectedId: string | null,
  absentPasses: number,
): { readonly id: string | null; readonly absentPasses: number } {
  if (selectedId === null) return { id: null, absentPasses: 0 };
  if (devices.some((device) => device.kind === kind && device.deviceId === selectedId)) {
    return { id: selectedId, absentPasses: 0 };
  }
  if (!devices.some((device) => device.kind === kind)) {
    return { id: selectedId, absentPasses };
  }
  const next = absentPasses + 1;
  return next >= DEVICE_ABSENT_PASS_LIMIT
    ? { id: null, absentPasses: next }
    : { id: selectedId, absentPasses: next };
}

/** Reconciles every saved device kind against one enumeration pass. */
export function planDeviceReconciliation(
  devices: readonly MediaDeviceInfo[],
  settings: DeviceSettingsIds,
  previous: DeviceAbsence = NO_DEVICE_ABSENCE,
): DeviceReconciliation {
  const input = reconcileKind(devices, "audioinput", settings.inputDeviceId, previous.input);
  const output = reconcileKind(devices, "audiooutput", settings.outputDeviceId, previous.output);
  const camera = reconcileKind(devices, "videoinput", settings.cameraDeviceId, previous.camera);
  return {
    inputDeviceId: input.id,
    outputDeviceId: output.id,
    cameraDeviceId: camera.id,
    absence: {
      input: input.absentPasses,
      output: output.absentPasses,
      camera: camera.absentPasses,
    },
  };
}
