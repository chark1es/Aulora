import type { VoiceDeviceSettings } from "@aulora/core";

/**
 * Resolves display metadata for call participants. The chat surface already
 * owns member names and role colors, so call components receive resolver
 * functions instead of importing the workspace data themselves.
 */
export interface CallIdentity {
  readonly nameOf: (userId: string) => string;
  readonly colorOf: (userId: string) => string | null;
}

export const UNKNOWN_IDENTITY: CallIdentity = {
  nameOf: () => "Member",
  colorOf: () => null,
};

/** Self-view mirroring only applies to the local camera, not a shared screen. */
export function shouldMirror(
  isSelf: boolean,
  sharingScreen: boolean,
  settings: VoiceDeviceSettings,
): boolean {
  return isSelf && !sharingScreen && settings.mirrorCamera;
}
