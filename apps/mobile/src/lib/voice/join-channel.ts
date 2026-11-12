import type { CallKind } from "@aulora/core";

/** The subset of the voice provider a channel join needs. */
export interface VoiceChannelJoinPort {
  readonly activeCalls: readonly { readonly id: string; readonly channelId: string | null }[];
  readonly joinCall: (_callId: string) => Promise<boolean>;
  readonly startCall: (_channelId: string, _kind: CallKind) => Promise<string | null>;
  readonly setCamera: (_on: boolean) => Promise<void>;
  /** Surfaces a rejection that happened outside the engine's own error path. */
  readonly reportError?: (_message: string) => void;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message.length > 0
    ? cause.message
    : "Could not join the call.";
}

/** What the pre-join surface should render for the current call state. */
export interface PreJoinCallView {
  readonly mode: "join" | "joined" | "denied";
  /** The current call error, shown instead of silently vanishing. */
  readonly error: string | null;
}

export function preJoinCallView(state: {
  readonly canConnect: boolean;
  readonly joined: boolean;
  readonly pending: boolean;
  readonly error: string | null;
}): PreJoinCallView {
  const error = state.error !== null && state.error.trim().length > 0 ? state.error : null;
  // The join controls stay rendered after a failure, so pressing one again is
  // the retry path; no separate retry action is needed.
  if (state.joined) return { mode: "joined", error };
  if (!state.canConnect) return { mode: "denied", error };
  return { mode: "join", error };
}

/**
 * Opens a voice channel from its pre-join screen.
 *
 * A channel can already have a live call, for example when this device left it
 * minimized. Joining that call is a different operation from starting one, so
 * the chosen media kind has to be applied afterwards; otherwise "Join with
 * video" would silently enter as voice-only.
 */
export function joinVoiceChannelWith(
  voice: VoiceChannelJoinPort,
  channelId: string,
  kind: CallKind = "voice",
): void {
  const live = voice.activeCalls.find((entry) => entry.channelId === channelId);
  if (live === undefined) {
    void voice
      .startCall(channelId, kind)
      .then((callId) => {
        // The engine only acquires the microphone, so the explicit video
        // choice has to be applied after the call actually started. A null
        // result means the start was refused or cancelled: leave the camera
        // off in that case.
        if (callId === null || kind !== "video") return undefined;
        return voice.setCamera(true);
      })
      .catch((cause: unknown) => {
        voice.reportError?.(errorMessage(cause));
      });
    return;
  }
  void voice
    .joinCall(live.id)
    .then((joined) => {
      if (joined && kind === "video") {
        void voice.setCamera(true).catch((cause: unknown) => {
          voice.reportError?.(errorMessage(cause));
        });
      }
    })
    .catch((cause: unknown) => {
      // A rejected claim (permission changed, network loss, ...) must be
      // visible on the pre-join screen, not swallowed while it stays open.
      voice.reportError?.(errorMessage(cause));
    });
}
