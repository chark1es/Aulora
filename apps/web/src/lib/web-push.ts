import type { ConvexReactClient } from "convex/react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { isDesktop } from "./desktop";
import { storageScope } from "./storage-scope";

/**
 * Browser Web Push registration.
 *
 * The VAPID public key comes from `server:publicConfig` (generated once at
 * setup and stable across restarts). The resulting `PushSubscription` is
 * serialized into this device's `pushToken`, so the Convex dispatch action can
 * reach it. Desktop uses the native notification bridge instead.
 */

/** Where the service worker is served from (Vite copies `public/` to root). */
export const PUSH_SERVICE_WORKER_URL = "/push-sw.js";

/** Whether the current environment can register for Web Push. */
export function isWebPushSupported(): boolean {
  if (isDesktop() || typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Decodes a base64url VAPID key into the bytes `PushManager.subscribe` wants. */
export function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

interface SerializableSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Serializes a subscription to the JSON stored in `devices.pushToken`. Accepts
 * `PushSubscription.toJSON()` output, whose fields are optional.
 */
export function serializeSubscription(subscription: {
  readonly endpoint?: string | null;
  readonly keys?: { readonly p256dh?: string | null; readonly auth?: string | null } | null;
}): string | null {
  const { endpoint, keys } = subscription;
  if (
    typeof endpoint !== "string" ||
    endpoint.length === 0 ||
    keys === null ||
    keys === undefined ||
    typeof keys.p256dh !== "string" ||
    typeof keys.auth !== "string"
  ) {
    return null;
  }
  const payload: SerializableSubscription = {
    endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  };
  return JSON.stringify(payload);
}

/** Registers the push service worker at the site root. */
export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isWebPushSupported()) {
    return null;
  }
  try {
    return await navigator.serviceWorker.register(PUSH_SERVICE_WORKER_URL, { scope: "/" });
  } catch {
    return null;
  }
}

/**
 * Returns the existing subscription or creates one for `publicKey`. Returns
 * `null` when permission is denied or the browser rejects the subscription.
 */
export async function ensurePushSubscription(
  registration: ServiceWorkerRegistration,
  publicKey: string,
): Promise<PushSubscription | null> {
  const existing = await registration.pushManager.getSubscription();
  if (existing !== null) {
    return existing;
  }
  try {
    return await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(publicKey) as unknown as BufferSource,
    });
  } catch {
    return null;
  }
}

interface DeviceRegistration {
  id?: string;
  revoked: boolean;
  pending?: Promise<boolean>;
  revocation?: Promise<void>;
}
const registrations = new WeakMap<ConvexReactClient, DeviceRegistration>();

function deviceKey(client: ConvexReactClient, userId: string | undefined): string | undefined {
  if (userId === undefined) return undefined;
  return `aulora.push.v1:${storageScope(client.url, userId)}`;
}
function savedDevice(key: string | undefined): string | undefined {
  try {
    return key === undefined ? undefined : (localStorage.getItem(key) ?? undefined);
  } catch {
    return undefined;
  }
}

/** Revoke this browser's row before auth expires, including a pending upsert. */
export function revokeWebPushDevice(client: ConvexReactClient, userId?: string): Promise<void> {
  const key = deviceKey(client, userId);
  const registration = registrations.get(client) ?? { revoked: false };
  registrations.set(client, registration);
  registration.revoked = true;
  registration.revocation = (async () => {
    await registration.pending;
    // A failed sign-out may have restored this authenticated session meanwhile.
    if (!registration.revoked) return;
    const id = registration.id ?? savedDevice(key);
    if (id === undefined) return;
    await client.mutation(api.devices.revoke, { deviceId: id as never });
    try {
      if (key !== undefined) localStorage.removeItem(key);
    } catch {
      /* best effort */
    }
  })();
  return registration.revocation;
}

/** Push is best effort; keep the full pending flow available to sign-out. */
export function registerWebPushDevice(
  client: ConvexReactClient,
  publicKey: string,
  userId?: string,
): Promise<boolean> {
  const device: DeviceRegistration = { revoked: false };
  registrations.set(client, device);
  const key = deviceKey(client, userId);
  device.pending = (async () => {
    try {
      const registration = await registerPushServiceWorker();
      if (registration === null || device.revoked) return false;
      const subscription = await ensurePushSubscription(registration, publicKey);
      if (subscription === null || device.revoked) return false;
      const serialized = serializeSubscription(subscription.toJSON());
      if (serialized === null) return false;
      const result = await client.mutation(api.devices.upsert, {
        platform: "web",
        pushToken: serialized,
      });
      device.id = result.deviceId;
      try {
        if (key !== undefined) localStorage.setItem(key, device.id);
      } catch {
        /* best effort */
      }
      if (device.revoked) {
        await client.mutation(api.devices.revoke, { deviceId: device.id as never });
        try {
          if (key !== undefined) localStorage.removeItem(key);
        } catch {
          /* best effort */
        }
        delete device.id;
        return false;
      }
      return true;
    } catch {
      return false;
    }
  })();
  return device.pending;
}

/** Restore registration after a failed sign-out, once revocation has settled. */
export async function restoreWebPushDevice(
  client: ConvexReactClient,
  userId?: string,
): Promise<void> {
  const registration = registrations.get(client);
  if (registration !== undefined) {
    registration.revoked = false;
    // Finish any revoke already sent to the server before recreating the row.
    await registration.revocation?.catch(() => undefined);
  }
  const config = await client.query(api.server.publicConfig, {});
  const publicKey = config.webPush?.publicKey;
  if (publicKey) await registerWebPushDevice(client, publicKey, userId);
}
