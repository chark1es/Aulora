import {
  type ClientVersionPolicy,
  type ClientVersionState,
  clientVersionState,
} from "@aulora/core";
import * as Application from "expo-application";
import { Platform } from "react-native";

/** Native build version; undefined in Expo Go and development builds. */
export const MOBILE_CLIENT_VERSION = Application.nativeApplicationVersion ?? "0.0.0-dev";

/** Store or beta channel the user must visit to install a newer build. */
export function mobileStoreUrl(platform: string): string {
  return platform === "ios"
    ? "https://testflight.apple.com/join/YUp4ugyv"
    : "https://play.google.com/store/apps/details?id=dev.spwnd.aulora";
}

export const MOBILE_STORE_URL = mobileStoreUrl(Platform.OS);

export function mobileVersionState(policy: ClientVersionPolicy | null): ClientVersionState {
  return clientVersionState(MOBILE_CLIENT_VERSION, policy);
}
