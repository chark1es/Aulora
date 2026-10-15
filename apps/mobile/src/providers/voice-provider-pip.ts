import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import { iosPipTarget } from "../components/voice/CallVideo";
import type { MobileVoiceSnapshot } from "../lib/voice/call-engine";
import {
  callHasVideo,
  enterPictureInPicture,
  exitPictureInPicture,
  onPictureInPictureChange,
  pickMainVideo,
  pipSupported,
  setPictureInPictureEnabled,
  startIosPip,
} from "../lib/voice/pip";
import type { VoicePip } from "./voice-provider-types";

/**
 * Picture-in-picture for the active call. It only offers itself while there is
 * video to float. On Android the app is allowed to float whenever such a call is
 * on, so leaving the app (home button, gesture, another app) floats it with no
 * further input; the control just does the same thing on demand.
 */
export function useVoicePip(snapshot: MobileVoiceSnapshot, selfUserId: string): VoicePip {
  const [active, setActive] = useState(false);
  const { call, local, remoteStreams } = snapshot;
  const supported = useMemo(pipSupported, []);
  const hasVideo = callHasVideo(call, local.video);
  const hasMain = pickMainVideo(call, remoteStreams, selfUserId) !== null;
  // iOS floats a remote video, so it needs one; Android floats the whole app.
  const offered = supported && hasVideo && (Platform.OS === "android" || hasMain);

  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }
    setPictureInPictureEnabled(supported && hasVideo);
    return () => {
      setPictureInPictureEnabled(false);
    };
  }, [supported, hasVideo]);

  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }
    return onPictureInPictureChange(setActive);
  }, []);

  // The call ending while floating would leave a tiny window with nothing in it.
  const inCall = call !== null;
  useEffect(() => {
    if (!inCall && active) {
      exitPictureInPicture();
    }
  }, [inCall, active]);

  const enter = useCallback(() => {
    if (Platform.OS === "android") {
      enterPictureInPicture();
    } else {
      startIosPip(iosPipTarget);
    }
  }, []);

  return useMemo(() => ({ supported: offered, active, enter }), [offered, active, enter]);
}
