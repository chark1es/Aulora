/**
 * Permission gating for the call addons. These only decide which controls the
 * UI offers; every function re-checks on the server.
 */

import { hasPermission, Permission } from "./permissions";

export interface AddonFlags {
  readonly transcription: boolean;
  readonly guestCalls: boolean;
  readonly scheduledCalls: boolean;
}

export const NO_ADDONS: AddonFlags = {
  transcription: false,
  guestCalls: false,
  scheduledCalls: false,
};

/** Reads the addon flags from `server.publicConfig`, tolerating an older backend. */
export function addonFlagsOf(
  addons: Partial<Record<keyof AddonFlags, boolean>> | undefined,
): AddonFlags {
  return {
    transcription: addons?.transcription === true,
    guestCalls: addons?.guestCalls === true,
    scheduledCalls: addons?.scheduledCalls === true,
  };
}

/** Start/stop is offered only with the permission, the addon on and a model ready. */
export function canStartTranscription(input: {
  readonly permissions: bigint;
  readonly addonEnabled: boolean;
  readonly modelReady: boolean;
  readonly inCall: boolean;
}): boolean {
  return (
    input.inCall &&
    input.addonEnabled &&
    input.modelReady &&
    hasPermission(input.permissions, Permission.StartTranscription)
  );
}

/** The transcripts surface needs the addon and `ViewTranscripts`. */
export function canViewTranscripts(permissions: bigint, addonEnabled: boolean): boolean {
  return addonEnabled && hasPermission(permissions, Permission.ViewTranscripts);
}

/** Deleting a transcript needs `ManageTranscription`. */
export function canDeleteTranscripts(permissions: bigint): boolean {
  return hasPermission(permissions, Permission.ManageTranscription);
}

/** The invite-guest action needs guest calls on and `CreateGuestLinks`. */
export function canCreateGuestLinks(permissions: bigint, addonEnabled: boolean): boolean {
  return addonEnabled && hasPermission(permissions, Permission.CreateGuestLinks);
}

/** Whether the permission alone makes someone a lobby manager. */
export function canManageGuestAccess(permissions: bigint, addonEnabled: boolean): boolean {
  return addonEnabled && hasPermission(permissions, Permission.ManageGuestAccess);
}

/** The Scheduled tab needs the addon and `ViewScheduledCalls`. */
export function canViewScheduledCalls(permissions: bigint, addonEnabled: boolean): boolean {
  return addonEnabled && hasPermission(permissions, Permission.ViewScheduledCalls);
}

/** Creating needs `ScheduleCalls` or `ManageScheduledCalls`. */
export function canScheduleCalls(permissions: bigint, addonEnabled: boolean): boolean {
  return (
    addonEnabled &&
    (hasPermission(permissions, Permission.ScheduleCalls) ||
      hasPermission(permissions, Permission.ManageScheduledCalls))
  );
}

/**
 * Edit/cancel affordance for one scheduled call. The server computes
 * `canManage`; this keeps the UI honest when that field is absent and hides the
 * actions for a call that can no longer change.
 */
export function canEditScheduledCall(call: {
  readonly canManage?: boolean;
  readonly status: "scheduled" | "open" | "ended" | "cancelled";
}): { readonly edit: boolean; readonly cancel: boolean } {
  const manage = call.canManage === true;
  return {
    edit: manage && call.status === "scheduled",
    cancel: manage && (call.status === "scheduled" || call.status === "open"),
  };
}
