import type { VoiceDeviceSettings } from "@aulora/core";
import type { Callback } from "../admin/callbacks";

/**
 * Resolves display metadata for call participants. The chat surface already
 * owns member names, so call components receive a resolver function instead of
 * importing the workspace data themselves.
 */
export interface CallIdentity {
  readonly nameOf: Callback<[userId: string], string>;
}

export const UNKNOWN_IDENTITY: CallIdentity = {
  nameOf: () => "Member",
};

/** Self-view mirroring only applies to the local camera, not a shared screen. */
export function shouldMirror(
  isSelf: boolean,
  sharingScreen: boolean,
  settings: VoiceDeviceSettings,
): boolean {
  return isSelf && !sharingScreen && settings.mirrorCamera;
}
