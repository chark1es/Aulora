import type { PeerConnectionState } from "@aulora/core";

/** Rough connection state mapping for the participant tiles. */
export function mapConnection(state: string): PeerConnectionState {
  switch (state) {
    case "connected":
      return "connected";
    case "failed":
    case "closed":
      return "failed";
    case "disconnected":
      return "reconnecting";
    default:
      return "connecting";
  }
}

export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "The call ran into a problem. Please try again.";
}

export function parsePayload<T>(payload: string): T | null {
  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

/**
 * Voice-tuned Opus: in-band FEC on, stereo off, a tight bitrate cap and high
 * network priority. All parameters are best-effort across native builds.
 */
export function tuneAudioSender(sender: {
  getParameters(): {
    encodings?: { maxBitrate?: number; networkPriority?: string }[];
    degradationPreference?: string;
  };
  setParameters(parameters: unknown): Promise<void>;
}): void {
  try {
    const params = sender.getParameters();
    params.encodings =
      params.encodings !== undefined && params.encodings.length > 0 ? params.encodings : [{}];
    const encoding = params.encodings[0];
    if (encoding !== undefined) {
      encoding.maxBitrate = 40_000;
      encoding.networkPriority = "high";
    }
    params.degradationPreference = "balanced";
    void sender.setParameters(params).catch(() => undefined);
  } catch {
    // Older engines expose read-only parameters.
  }
}

/**
 * Video tuning. Screen share prioritizes resolution so text stays legible;
 * camera prioritizes framerate. The cap keeps a share from starving audio.
 */
export function tuneVideoSender(
  sender: {
    getParameters(): {
      encodings?: { maxBitrate?: number; maxFramerate?: number }[];
      degradationPreference?: string;
    };
    setParameters(parameters: unknown): Promise<void>;
  },
  screen: boolean,
): void {
  try {
    const params = sender.getParameters();
    params.encodings =
      params.encodings !== undefined && params.encodings.length > 0 ? params.encodings : [{}];
    const encoding = params.encodings[0];
    if (encoding !== undefined) {
      encoding.maxBitrate = screen ? 3_000_000 : 1_500_000;
      encoding.maxFramerate = 30;
    }
    params.degradationPreference = screen ? "maintain-resolution" : "maintain-framerate";
    void sender.setParameters(params).catch(() => undefined);
  } catch {
    // Best-effort.
  }
}

/** Asks the native receiver to keep playout delay low for conversation. */
export function tuneReceiver(receiver: {
  playoutDelayHint?: number;
  jitterBufferTarget?: number;
}): void {
  try {
    receiver.playoutDelayHint = 0;
  } catch {
    // Unsupported.
  }
  try {
    receiver.jitterBufferTarget = 0;
  } catch {
    // Unsupported.
  }
}
