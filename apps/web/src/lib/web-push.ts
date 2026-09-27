import type { ConvexReactClient } from "convex/react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { isDesktop } from "./desktop";

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

/**
 * Full registration flow: service worker, subscription, then device upsert.
 * Returns `true` when the subscription was stored. Never throws — Web Push is
 * an enhancement and must not break sign-in or chat.
 */
export async function registerWebPushDevice(
  client: ConvexReactClient,
  publicKey: string,
): Promise<boolean> {
  const registration = await registerPushServiceWorker();
  if (registration === null) {
    return false;
  }
  const subscription = await ensurePushSubscription(registration, publicKey);
  if (subscription === null) {
    return false;
  }
  const serialized = serializeSubscription(subscription.toJSON());
  if (serialized === null) {
    return false;
  }
  try {
    await client.mutation(api.devices.upsert, {
      platform: "web",
      pushToken: serialized,
    });
    return true;
  } catch {
    return false;
  }
}
