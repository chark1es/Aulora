import type { ConvexReactClient } from "convex/react";
import { useEffect, useState } from "react";
import { registerDevicePushToken, registerForPushNotifications } from "./push";

export type PushRegistrationState =
  | "idle"
  | "registering"
  | "registered"
  | "denied"
  | "unavailable";

/**
 * Registers this device's native push token with the server once per session.
 * Uses APNs/FCM tokens (never Expo's hosted push); silently no-ops on a
 * simulator or when permission is denied.
 */
export function usePushRegistration(
  client: ConvexReactClient | undefined,
  platformTag: string,
): PushRegistrationState {
  const [state, setState] = useState<PushRegistrationState>("idle");

  useEffect(() => {
    if (client === undefined) {
      return;
    }
    let cancelled = false;
    setState("registering");
    void (async () => {
      try {
        const registration = await registerForPushNotifications();
        if (cancelled) {
          return;
        }
        if (registration === null) {
          setState("denied");
          return;
        }
        await registerDevicePushToken(client, registration, platformTag);
        if (!cancelled) {
          setState("registered");
        }
      } catch {
        if (!cancelled) {
          setState("unavailable");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, platformTag]);

  return state;
}
