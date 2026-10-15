import type { ReactNode } from "react";
import { Platform, StyleSheet } from "react-native";
import { type VoiceIosPipOptions, type VoiceStream, videoRenderer } from "../../lib/voice/webrtc";

/** The system takes this video over when the app goes to the background. */
const IOS_PIP: VoiceIosPipOptions = {
  enabled: true,
  startAutomatically: true,
  stopAutomatically: true,
  preferredSize: { width: 720, height: 1280 },
};

/** Where `startIosPip` finds the view to float; set by whichever video is the main one. */
export const iosPipTarget: { current: unknown } = { current: null };

export interface CallVideoProps {
  readonly stream: VoiceStream | null;
  readonly mirror?: boolean;
  /**
   * This is the video to float when the app is left (iOS). Give it to one video
   * at a time: each one with it creates its own picture-in-picture controller.
   */
  readonly pip?: boolean;
  /** Rendered when the native renderer or stream URL is unavailable. */
  readonly fallback: ReactNode;
}

/**
 * Renders a remote or local video track through `react-native-webrtc`'s
 * `RTCView`, falling back to a caller-provided tile when WebRTC is absent or
 * the stream cannot produce a URL. Keeping the native component behind the
 * `webrtc.ts` accessor is what lets this file compile without the package.
 */
export function CallVideo({ stream, mirror, pip = false, fallback }: CallVideoProps) {
  const Renderer = videoRenderer();
  const url = stream?.toURL?.() ?? null;
  if (Renderer === null || url === null) {
    return <>{fallback}</>;
  }
  const floats = pip && Platform.OS === "ios";
  return (
    <Renderer
      streamURL={url}
      mirror={mirror === true}
      objectFit="cover"
      style={StyleSheet.absoluteFill}
      {...(floats ? { iosPIP: IOS_PIP, ref: iosPipTarget } : {})}
    />
  );
}
