import type { CallKind } from "@aulora/core";

/** The subset of the voice provider a channel join needs. */
export interface VoiceChannelJoinPort {
  readonly activeCalls: readonly { readonly id: string; readonly channelId: string | null }[];
  readonly joinCall: (_callId: string) => Promise<boolean>;
  readonly startCall: (_channelId: string, _kind: CallKind) => Promise<string | null>;
  readonly setCamera: (_on: boolean) => Promise<void>;
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
    void voice.startCall(channelId, kind);
    return;
  }
  void voice
    .joinCall(live.id)
    .then((joined) => {
      if (joined && kind === "video") {
        void voice.setCamera(true);
      }
    })
    .catch(() => undefined);
}
