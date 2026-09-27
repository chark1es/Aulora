import type { ConvexReactClient } from "convex/react";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "../../../../packages/convex/convex/_generated/api";

/**
 * Mobile push registration.
 *
 * Deliberately uses `getDevicePushTokenAsync()` — the native APNs/FCM token —
 * and **not** Expo's hosted push service, so a self-hosted Aulora server can
 * send wakes through the operator's own push relay (or the project relay for
 * official store builds). Payloads carry only opaque ids; the app rewrites the
 * notification locally.
 */

export interface PushRegistration {
  readonly token: string;
  readonly platform: "ios" | "android";
}

/** Shows foreground notifications; without this, they are silent. */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });
}

/**
 * Asks for permission and returns the native device push token, or `null` when
 * permission is denied or the app is running on a simulator.
 */
export async function registerForPushNotifications(): Promise<PushRegistration | null> {
  if (!Device.isDevice) {
    return null;
  }
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== "granted") {
    return null;
  }
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Messages",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const token = await Notifications.getDevicePushTokenAsync();
  const platform = Platform.OS === "ios" ? "ios" : "android";
  return { token: token.data, platform };
}

/**
 * Records the push token on this device's server row. Upsert matches an
 * existing row by push token, so re-registering refreshes rather than
 * duplicates (see `devices.upsert`).
 */
export async function registerDevicePushToken(
  client: ConvexReactClient,
  registration: PushRegistration,
  platformTag: string,
): Promise<void> {
  await client.mutation(api.devices.upsert, {
    platform: platformTag,
    pushToken: registration.token,
  });
}
