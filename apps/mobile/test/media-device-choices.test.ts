import { describe, expect, it } from "vitest";
import {
  bluetoothInputName,
  deviceChoices,
  isBluetoothInputType,
  looksLikeBluetooth,
  reconcileDeviceId,
  SYSTEM_DEFAULT_DEVICE,
  selectedDeviceLabel,
} from "../src/lib/voice/media-device-choices";

const devices = [
  { deviceId: "mic-1", kind: "audioinput" as const, label: "Built-in Microphone" },
  { deviceId: "mic-2", kind: "audioinput" as const, label: "AirPods Pro" },
  { deviceId: "speaker-1", kind: "audiooutput" as const, label: "Speaker" },
  { deviceId: "camera-1", kind: "videoinput" as const, label: "Back Camera" },
];

describe("Bluetooth detection", () => {
  it("recognises Bluetooth labels and platform input types", () => {
    expect(looksLikeBluetooth("AirPods Pro")).toBe(true);
    expect(looksLikeBluetooth("Bluetooth headset")).toBe(true);
    expect(looksLikeBluetooth("Built-in Microphone")).toBe(false);
    expect(isBluetoothInputType("BluetoothHFP")).toBe(true);
    expect(isBluetoothInputType("BluetoothSCO")).toBe(true);
    expect(isBluetoothInputType("BuiltInMic")).toBe(false);
    expect(
      bluetoothInputName([
        { type: "BuiltInMic", name: "iPhone Microphone" },
        { type: "BluetoothHFP", name: "AirPods Pro" },
      ]),
    ).toBe("AirPods Pro");
    expect(bluetoothInputName([{ type: "BuiltInMic", name: "iPhone Microphone" }])).toBeUndefined();
  });
});

describe("deviceChoices", () => {
  it("puts the system route first and only lists the requested kind", () => {
    const choices = deviceChoices(devices, "audioinput", "AirPods Pro");
    expect(choices.map((choice) => choice.id)).toEqual([SYSTEM_DEFAULT_DEVICE, "mic-1", "mic-2"]);
    expect(choices[0]?.hint).toBe("Bluetooth · AirPods Pro");
    expect(choices[2]?.hint).toBe("Bluetooth");
  });

  it("explains the system route without a detected Bluetooth device", () => {
    expect(deviceChoices(devices, "videoinput")[0]?.hint).toBe("Follows this device's audio route");
  });
});

describe("selectedDeviceLabel", () => {
  it("names the saved device or falls back to the system route", () => {
    expect(selectedDeviceLabel(devices, "audioinput", "mic-2")).toBe("AirPods Pro");
    expect(selectedDeviceLabel(devices, "audioinput", null)).toBe("System default");
    expect(selectedDeviceLabel(devices, "audioinput", "missing")).toBe("System default");
  });
});

describe("reconcileDeviceId", () => {
  it("keeps a present device and clears one that disconnected", () => {
    expect(reconcileDeviceId(devices, "audioinput", null)).toBeNull();
    expect(reconcileDeviceId(devices, "audioinput", "mic-2")).toBe("mic-2");
    expect(reconcileDeviceId(devices, "audioinput", "gone")).toBeNull();
    expect(reconcileDeviceId(devices, "videoinput", "mic-2")).toBeNull();
  });
});
