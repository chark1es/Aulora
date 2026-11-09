import { canStartTranscription, hasPermission, Permission } from "@aulora/core";

/**
 * What the transcription control should offer right now.
 *
 * - `start`: no session is running, and the member may start one (permission,
 *   addon on, the transcriber service installed and running with an engine loaded, model ready, in a
 *   call). The server refuses `transcription.start` without the service and a
 *   ready model, so the control is not offered rather than failing on press.
 * - `stop`: a session IS running. Anyone who may start or manage transcription
 *   must still be able to end it, whether or not the addon is still switched on
 *   and whether or not the model is still ready: switching the addon off while
 *   a session runs must never strand the session without a way to stop it.
 * - `none`: nothing to offer.
 */
export function transcriptionOffer(input: {
  readonly permissions: bigint;
  readonly addonEnabled: boolean;
  readonly modelReady: boolean;
  /** `transcription.status.serviceInstalled`: the transcriber has a recent heartbeat. */
  readonly serviceInstalled: boolean;
  /**
   * `transcription.status.runtimeReady`: the running container has an engine
   * loaded, separate from a model being selected or downloaded. The server
   * refuses Start without it.
   */
  readonly runtimeReady: boolean;
  readonly inCall: boolean;
  /** The roster says a transcription session is running in this call. */
  readonly transcribing: boolean;
}): "start" | "stop" | "none" {
  if (input.transcribing) {
    const mayStop =
      input.inCall &&
      (hasPermission(input.permissions, Permission.StartTranscription) ||
        hasPermission(input.permissions, Permission.ManageTranscription));
    return mayStop ? "stop" : "none";
  }
  return input.serviceInstalled && input.runtimeReady && canStartTranscription(input)
    ? "start"
    : "none";
}
