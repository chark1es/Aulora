import { Platform } from "react-native";
import {
  enterPictureInPicture,
  exitPictureInPicture,
  onPictureInPictureChange,
  pictureInPictureSupported,
  setPictureInPictureEnabled,
} from "../../../modules/aulora-pip";
import { startIosPip, webrtcAvailable } from "./webrtc";

/** iOS needs 15 for the video-call PiP controller. */
const IOS_MINIMUM = 15;

export function pipSupported(): boolean {
  if (Platform.OS === "android") {
    return pictureInPictureSupported();
  }
  return (
    Platform.OS === "ios" &&
    webrtcAvailable &&
    Number.parseInt(String(Platform.Version), 10) >= IOS_MINIMUM
  );
}

export { callHasVideo, type MainVideo, pickMainVideo } from "./pip-main";
export {
  enterPictureInPicture,
  exitPictureInPicture,
  onPictureInPictureChange,
  setPictureInPictureEnabled,
  startIosPip,
};
