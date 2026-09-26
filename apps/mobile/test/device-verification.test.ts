import { describe, expect, it } from "vitest";
import {
  confirmSafetyNumber,
  hexToBytes,
  safetyNumberForDevices,
  verificationQrForDevice,
} from "../src/lib/device-verification";

const DEVICE_A = { id: "device-a", identityKey: "01".repeat(32) };
const DEVICE_B = { id: "device-b", identityKey: "ab".repeat(32) };

describe("hexToBytes", () => {
  it("decodes hex and rejects malformed input", () => {
    expect(hexToBytes("00ff10")).toEqual(new Uint8Array([0, 255, 16]));
    expect(hexToBytes("AB")).toEqual(new Uint8Array([171]));
    expect(() => hexToBytes("abc")).toThrow();
    expect(() => hexToBytes("zz")).toThrow();
  });
});

describe("safety numbers", () => {
  it("is symmetric for the same pair", () => {
    const forward = safetyNumberForDevices(DEVICE_A, DEVICE_B);
    const reverse = safetyNumberForDevices(DEVICE_B, DEVICE_A);
    expect(forward.digits).toBe(reverse.digits);
    expect(forward.digits).toHaveLength(60);
  });

  it("confirms the displayed number", () => {
    const display = safetyNumberForDevices(DEVICE_A, DEVICE_B).display;
    expect(confirmSafetyNumber(DEVICE_A, DEVICE_B, display)).toBe(true);
    expect(confirmSafetyNumber(DEVICE_A, DEVICE_B, "0".repeat(60))).toBe(false);
  });
});

describe("verification QR", () => {
  it("encodes an aulora://verify URI for the device", () => {
    const uri = verificationQrForDevice(DEVICE_A.id, DEVICE_A.identityKey);
    expect(uri.startsWith("aulora://verify?d=")).toBe(true);
  });
});
