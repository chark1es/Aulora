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

/**
 * The device record's platform tag. The server targets push by the real
 * platform (`ios`/`android`/`unifiedpush`), never a generic `mobile`, so this
 * must always be the concrete `Platform.OS`.
 */
export function devicePushPlatform(): "ios" | "android" {
  return Platform.OS === "ios" ? "ios" : "android";
}

/** Android channel id for ringing calls, separate from message notifications. */
export const CALL_CHANNEL_ID = "calls";

/**
 * Shows foreground notifications; without this, they are silent. Also declares
 * the high-importance Android `calls` channel so a backgrounded incoming call
 * rings and pops, rather than arriving as a quiet default notification.
 */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const isCall = notification.request.content.data?.kind === "call";
      return {
        shouldShowBanner: true,
        shouldShowList: true,
        // Only calls ring; message cues are synthesized separately, so a
        // foreground message notification must not double up with them.
        shouldPlaySound: isCall,
        shouldSetBadge: true,
      };
    },
  });
  if (Platform.OS === "android") {
    void Notifications.setNotificationChannelAsync(CALL_CHANNEL_ID, {
      name: "Calls",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 400, 200, 400],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      sound: "default",
    });
  }
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
  // `getDevicePushTokenAsync` reaches APNs/FCM directly. On a build without
  // `google-services.json` (Android) this rejects; callers treat that as
  // "push unavailable" and the app keeps running normally.
  const token = await Notifications.getDevicePushTokenAsync();
  return { token: token.data, platform: devicePushPlatform() };
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
