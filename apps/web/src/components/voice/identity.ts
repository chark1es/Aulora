import type { CallParticipantView, VoiceDeviceSettings } from "@aulora/core";
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

/**
 * What to call someone in a call, on every surface that lists participants. A
 * guest carries their own chosen name (never a directory lookup, which would
 * call them "Member" or show their raw session id); without one they are
 * "Guest". Members resolve through the directory.
 */
export function participantName(
  participant: Pick<CallParticipantView, "userId" | "displayName" | "isGuest">,
  identity: CallIdentity,
): string {
  if (participant.isGuest === true) {
    const name = participant.displayName?.trim() ?? "";
    return name.length > 0 ? name : "Guest";
  }
  return identity.nameOf(participant.userId);
}
