import type { ConvexReactClient } from "convex/react";
import * as Device from "expo-device";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../../packages/convex/convex/_generated/api";
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
): { readonly state: PushRegistrationState; readonly unregister: () => Promise<void> } {
  const [state, setState] = useState<PushRegistrationState>("idle");
  const device = useRef<{ readonly client: ConvexReactClient; readonly id: string } | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const unregister = useCallback(async () => {
    // Registration may still be waiting for the native token when sign-out starts.
    await pending.current;
    const registered = device.current;
    if (registered === null) return;
    await registered.client.mutation(api.devices.revoke, { deviceId: registered.id as never });
    device.current = null;
  }, []);

  useEffect(() => {
    if (client === undefined) {
      return;
    }
    let cancelled = false;
    setState("registering");
    const registrationTask = (async () => {
      try {
        const registration = await registerForPushNotifications();
        if (cancelled) {
          return;
        }
        if (registration === null) {
          setState(Device.isDevice ? "denied" : "unavailable");
          return;
        }
        const id = await registerDevicePushToken(client, registration, platformTag);
        device.current = { client, id };
        if (!cancelled) {
          setState("registered");
        }
      } catch {
        if (!cancelled) {
          setState("unavailable");
        }
      }
    })();
    pending.current = registrationTask;
    return () => {
      cancelled = true;
    };
  }, [client, platformTag]);

  return { state, unregister };
}
