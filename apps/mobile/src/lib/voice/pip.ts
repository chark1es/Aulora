import { Platform } from "react-native";
import {
  enterPictureInPicture,
  exitPictureInPicture,
  onPictureInPictureChange,
  pictureInPictureSupported,
  setPictureInPictureEnabled,
} from "../../../modules/aulora-pip";
import { startIosPip, webrtcAvailable } from "./webrtc";

/**
 * Picture-in-picture for calls on a phone.
 *
 *  - Android floats the whole app (a small module around `enterPictureInPicture`
 *    Mode), which then shows only the main video.
 *  - iOS floats the video itself: the main `RTCView` carries `iosPIP` options and
 *    the system takes it over when the app goes to the background.
 *
 * Both only make sense while there is something to watch.
 */
export interface PipState {
  readonly supported: boolean;
  /** The app is currently in the floating window (Android; iOS does not report it). */
  readonly active: boolean;
}

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
