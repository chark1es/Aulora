import { describe, expect, it } from "vitest";
import {
  bluetoothInputName,
  classifyRoute,
  DEVICE_ABSENT_PASS_LIMIT,
  deviceChoices,
  inputForRoute,
  isBluetoothInputType,
  looksLikeBluetooth,
  NO_DEVICE_ABSENCE,
  planDeviceReconciliation,
  SYSTEM_DEFAULT_DEVICE,
  selectedDeviceLabel,
  selectedDeviceRoute,
} from "../src/lib/voice/media-device-choices";

const devices = [
  { deviceId: "mic-1", kind: "audioinput" as const, label: "Built-in Microphone" },
  { deviceId: "mic-2", kind: "audioinput" as const, label: "AirPods Pro" },
  { deviceId: "speaker-1", kind: "audiooutput" as const, label: "Speaker" },
  { deviceId: "camera-1", kind: "videoinput" as const, label: "Back Camera" },
];

const recorderInputs = [
  { uid: "1", name: "iPhone Microphone", type: "MicrophoneBuiltIn" },
  { uid: "2", name: "AirPods Pro", type: "BluetoothHFP" },
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

  it("tags a choice with its typed route instead of leaving the UI to parse labels", () => {
    expect(classifyRoute("AirPods Pro")).toBe("bluetooth");
    expect(classifyRoute("Built-in Microphone")).toBe("device");
    expect(deviceChoices(devices, "audioinput").map((choice) => choice.route)).toEqual([
      "system",
      "device",
      "bluetooth",
    ]);
    expect(selectedDeviceRoute(devices, "audioinput", "mic-2")).toBe("bluetooth");
    expect(selectedDeviceRoute(devices, "audioinput", "mic-1")).toBe("device");
    expect(selectedDeviceRoute(devices, "audioinput", null)).toBe("system");
    expect(selectedDeviceRoute(devices, "audioinput", "gone")).toBe("system");
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

describe("native route selection", () => {
  it("maps a Bluetooth route to the headset and a system route to the built-in mic", () => {
    expect(inputForRoute(recorderInputs, "bluetooth")?.uid).toBe("2");
    expect(inputForRoute(recorderInputs, "system")?.uid).toBe("1");
    // A concrete WebRTC device id cannot be mapped onto the native route list;
    // the call engine selects it at capture time instead.
    expect(inputForRoute(recorderInputs, "device")).toBeUndefined();
    expect(inputForRoute([], "system")).toBeUndefined();
  });
});

describe("planDeviceReconciliation", () => {
  const settings = {
    inputDeviceId: "mic-2",
    outputDeviceId: "speaker-1",
    cameraDeviceId: "camera-1",
  };

  it("keeps every saved device when the list still contains it", () => {
    const plan = planDeviceReconciliation(devices, settings);
    expect(plan).toMatchObject(settings);
    expect(plan.absence).toEqual(NO_DEVICE_ABSENCE);
  });

  it("keeps a missing device through the first partial enumeration", () => {
    const withoutHeadset = devices.filter((device) => device.deviceId !== "mic-2");
    const first = planDeviceReconciliation(withoutHeadset, settings);
    expect(first.inputDeviceId).toBe("mic-2");
    expect(first.absence.input).toBe(1);

    const second = planDeviceReconciliation(withoutHeadset, settings, first.absence);
    expect(second.inputDeviceId).toBeNull();
    expect(second.absence.input).toBe(DEVICE_ABSENT_PASS_LIMIT);
  });

  it("resets the absence count when the device returns", () => {
    const withoutHeadset = devices.filter((device) => device.deviceId !== "mic-2");
    const first = planDeviceReconciliation(withoutHeadset, settings, NO_DEVICE_ABSENCE);
    const returned = planDeviceReconciliation(devices, settings, first.absence);
    expect(returned.inputDeviceId).toBe("mic-2");
    expect(returned.absence.input).toBe(0);
    // A later single miss is judged from scratch, not from the old count.
    expect(planDeviceReconciliation(withoutHeadset, settings, returned.absence).inputDeviceId).toBe(
      "mic-2",
    );
  });

  it("does not clear a device kind the platform did not enumerate at all", () => {
    // Outputs are commonly absent on mobile WebRTC before a call starts; that
    // says nothing about whether the saved speaker is gone.
    const noOutputs = devices.filter((device) => device.kind !== "audiooutput");
    const first = planDeviceReconciliation(noOutputs, settings);
    const second = planDeviceReconciliation(noOutputs, settings, first.absence);
    expect(second.outputDeviceId).toBe("speaker-1");
    expect(second.absence.output).toBe(0);
  });
});
