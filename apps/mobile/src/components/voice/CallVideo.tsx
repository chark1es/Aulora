import type { ReactNode } from "react";
import { StyleSheet } from "react-native";
import { type VoiceStream, videoRenderer } from "../../lib/voice/webrtc";

export interface CallVideoProps {
  readonly stream: VoiceStream | null;
  readonly mirror?: boolean;
  /** Rendered when the native renderer or stream URL is unavailable. */
  readonly fallback: ReactNode;
}

/**
 * Renders a remote or local video track through `react-native-webrtc`'s
 * `RTCView`, falling back to a caller-provided tile when WebRTC is absent or
 * the stream cannot produce a URL. Keeping the native component behind the
 * `webrtc.ts` accessor is what lets this file compile without the package.
 */
export function CallVideo({ stream, mirror, fallback }: CallVideoProps) {
  const Renderer = videoRenderer();
  const url = stream?.toURL?.() ?? null;
  if (Renderer === null || url === null) {
    return <>{fallback}</>;
  }
  return (
    <Renderer
      streamURL={url}
      mirror={mirror === true}
      objectFit="cover"
      style={StyleSheet.absoluteFill}
    />
  );
}
