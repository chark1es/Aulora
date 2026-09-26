/**
 * Device verification on mobile.
 *
 * A new phone shows a safety number (and optionally a QR) derived from its
 * identity key and an existing device's. Comparing the same 60 digits on both
 * screens proves there is no machine in the middle. The actual approval is a
 * `devices.approve` mutation; QR **scanning** needs the camera and a real
 * device — everything here (fingerprints, QR payloads, comparison) is pure and
 * unit-tested.
 */

import {
  computeSafetyNumber,
  encodeVerificationQr,
  matchesSafetyNumber,
  type SafetyNumber,
  type VerificationDevice,
} from "@aulora/crypto";

/** Decodes the hex identity key format the device registry stores. */
export function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim();
  if (normalized.length % 2 !== 0 || /[^0-9a-fA-F]/.test(normalized)) {
    throw new Error("identity key must be an even-length hex string");
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** Builds the verification view of a device from its registry fields. */
export function verificationDevice(deviceId: string, identityKeyHex: string): VerificationDevice {
  return { deviceId, signaturePublicKey: hexToBytes(identityKeyHex) };
}

/** The 60-digit fingerprint shared by two devices. */
export function safetyNumberForDevices(
  first: { id: string; identityKey: string },
  second: { id: string; identityKey: string },
): SafetyNumber {
  return computeSafetyNumber(
    verificationDevice(first.id, first.identityKey),
    verificationDevice(second.id, second.identityKey),
  );
}

/** The QR URI this device shows for another to scan. */
export function verificationQrForDevice(deviceId: string, identityKeyHex: string): string {
  return encodeVerificationQr(verificationDevice(deviceId, identityKeyHex));
}

/**
 * Confirms a number the person read off the other device. Constant-time; the
 * caller approves with `api.devices.approve` only when this is `true`.
 */
export function confirmSafetyNumber(
  first: { id: string; identityKey: string },
  second: { id: string; identityKey: string },
  candidate: string,
): boolean {
  return matchesSafetyNumber(
    verificationDevice(first.id, first.identityKey),
    verificationDevice(second.id, second.identityKey),
    candidate,
  );
}
