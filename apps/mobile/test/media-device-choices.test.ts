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
  savedRouteTarget,
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
    // Availability is not the active route: the phone may still be using its
    // own microphone while the headset is connected.
    expect(choices[0]?.hint).toBe("Bluetooth available · AirPods Pro");
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
    // A concrete non-Bluetooth WebRTC device leaves the shared session on the
    // wired/built-in route, which is also the "device" class.
    expect(inputForRoute(recorderInputs, "device")?.uid).toBe("1");
    expect(inputForRoute([], "system")).toBeUndefined();
  });
});

describe("native routes as selectable choices", () => {
  const native = { inputs: recorderInputs, activeUid: "1" };

  it("adds a Bluetooth route the WebRTC output list does not enumerate", () => {
    // Mobile WebRTC often lists no audiooutput at all; the connected headset
    // still has to be a real, selectable row and not merely a subtitle.
    const outputs = [{ deviceId: "speaker-1", kind: "audiooutput" as const, label: "Speaker" }];
    const choices = deviceChoices(outputs, "audiooutput", "AirPods Pro", native);
    expect(choices.map((choice) => choice.id)).toEqual([
      SYSTEM_DEFAULT_DEVICE,
      "speaker-1",
      "native:2",
    ]);
    const bluetooth = choices.find((choice) => choice.id === "native:2");
    expect(bluetooth).toMatchObject({
      label: "AirPods Pro",
      hint: "Bluetooth",
      route: "bluetooth",
      nativeUid: "2",
    });
  });

  it("labels the actual active route separately from an available headset", () => {
    const choices = deviceChoices(devices, "audioinput", "AirPods Pro", native);
    // The phone microphone is in use even though a headset is available.
    expect(choices[0]?.hint).toBe("Current · iPhone Microphone");
    // WebRTC already lists "AirPods Pro", so the native duplicate is not shown.
    expect(choices.filter((choice) => choice.id.startsWith("native:"))).toEqual([]);
  });

  it("maps saved native and WebRTC choices onto concrete platform targets", () => {
    expect(savedRouteTarget(recorderInputs, devices, "audiooutput", "native:2")).toEqual({
      route: "bluetooth",
      uid: "2",
    });
    expect(savedRouteTarget(recorderInputs, devices, "audioinput", "mic-2")).toEqual({
      route: "bluetooth",
    });
    expect(savedRouteTarget(recorderInputs, devices, "audiooutput", "speaker-1")).toEqual({
      route: "device",
    });
    expect(savedRouteTarget(recorderInputs, devices, "audioinput", null)).toBeUndefined();
    // A native uid that vanished from the platform list cannot be applied.
    expect(savedRouteTarget(recorderInputs, devices, "audioinput", "native:9")).toBeUndefined();
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

  it("keeps a saved native route that WebRTC never enumerates", () => {
    const nativeSettings = { ...settings, outputDeviceId: "native:2" };
    let absence = NO_DEVICE_ABSENCE;
    for (let pass = 0; pass < 3; pass++) {
      const plan = planDeviceReconciliation(devices, nativeSettings, absence);
      absence = plan.absence;
      expect(plan.outputDeviceId).toBe("native:2");
    }
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
