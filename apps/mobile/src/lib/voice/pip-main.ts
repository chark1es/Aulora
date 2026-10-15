import type { CallView } from "@aulora/core";
import type { VoiceStream } from "./webrtc";

/** Whether a call has anything worth floating: video from anyone, or a shared screen. */
export function callHasVideo(call: CallView | null, localVideo: boolean): boolean {
  if (call === null) {
    return false;
  }
  return (
    call.kind === "video" ||
    localVideo ||
    call.participants.some((entry) => entry.video || entry.sharingScreen)
  );
}

export interface MainVideo {
  readonly userId: string;
  readonly stream: VoiceStream;
}

/**
 * The picture a floating window should show: the screen being shared, else the
 * first other participant who has a camera on. `null` when nobody has video.
 */
export function pickMainVideo(
  call: CallView | null,
  remoteStreams: ReadonlyMap<string, VoiceStream>,
  selfUserId: string,
): MainVideo | null {
  if (call === null) {
    return null;
  }
  const others = call.participants.filter((entry) => entry.userId !== selfUserId);
  const candidates = [
    ...others.filter((entry) => entry.sharingScreen),
    ...others.filter((entry) => entry.video && !entry.sharingScreen),
  ];
  for (const entry of candidates) {
    const stream = remoteStreams.get(entry.userId);
    if (stream !== undefined && stream.getVideoTracks().length > 0) {
      return { userId: entry.userId, stream };
    }
  }
  return null;
}
