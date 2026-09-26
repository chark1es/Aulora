import { describe, expect, it } from "vitest";
import {
  computeSafetyNumber,
  decodeVerificationQr,
  encodeVerificationQr,
  matchesSafetyNumber,
  normalizeSafetyNumber,
  type VerificationDevice,
} from "../src/index.js";

function device(id: string, fill: number): VerificationDevice {
  return { deviceId: id, signaturePublicKey: new Uint8Array(32).fill(fill) };
}

describe("computeSafetyNumber", () => {
  it("is symmetric and deterministic", () => {
    const a = device("device-a", 1);
    const b = device("device-b", 2);
    const forward = computeSafetyNumber(a, b);
    const reverse = computeSafetyNumber(b, a);
    expect(forward.digits).toBe(reverse.digits);
    expect(forward.digits).toHaveLength(60);
    expect(forward.groups).toHaveLength(12);
    for (const group of forward.groups) {
      expect(group).toMatch(/^[0-9]{5}$/);
    }
    expect(forward.display).toBe(forward.groups.join(" "));
  });

  it("changes when either key changes", () => {
    const a = device("device-a", 1);
    const b = device("device-b", 2);
    const c = device("device-c", 3);
    expect(computeSafetyNumber(a, b).digits).not.toBe(computeSafetyNumber(a, c).digits);
  });
});

describe("matchesSafetyNumber", () => {
  it("accepts the correct number regardless of spacing", () => {
    const a = device("device-a", 4);
    const b = device("device-b", 5);
    const { display } = computeSafetyNumber(a, b);
    expect(matchesSafetyNumber(a, b, display)).toBe(true);
    expect(normalizeSafetyNumber(display)).toBe(computeSafetyNumber(a, b).digits);
  });

  it("rejects a wrong number", () => {
    const a = device("device-a", 6);
    const b = device("device-b", 7);
    expect(matchesSafetyNumber(a, b, "00000 00000 00000 00000 00000 00000")).toBe(false);
  });
});

describe("verification QR payloads", () => {
  it("round-trips a device through the aulora:// scheme", () => {
    const source = device("device-qr", 9);
    const uri = encodeVerificationQr(source);
    expect(uri.startsWith("aulora://verify?d=")).toBe(true);
    const decoded = decodeVerificationQr(uri);
    expect(decoded).not.toBeNull();
    expect(decoded?.deviceId).toBe(source.deviceId);
    expect(decoded?.signaturePublicKey).toEqual(source.signaturePublicKey);
  });

  it("accepts an https universal link with the same query", () => {
    const uri = encodeVerificationQr(device("device-https", 10));
    const query = uri.slice(uri.indexOf("?"));
    const decoded = decodeVerificationQr(`https://chat.example.com/verify${query}`);
    expect(decoded?.deviceId).toBe("device-https");
  });

  it("rejects malformed payloads", () => {
    expect(decodeVerificationQr("aulora://verify")).toBeNull();
    expect(decodeVerificationQr("aulora://verify?d=not-base64")).toBeNull();
    expect(decodeVerificationQr("https://example.com/elsewhere")).toBeNull();
  });
});
