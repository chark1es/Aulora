/**
 * Push-relay client used by Convex actions to wake mobile devices.
 *
 * iOS and stock Android only deliver push through APNs and FCM, whose
 * credentials belong to the *app builder*, not the self-hoster. The project
 * therefore runs a small relay (`infra/push-relay`) that holds those
 * credentials and forwards **content-free wakeups only**: an opaque server id,
 * channel id and message id. The server never sends message text.
 *
 * This module builds the request and sends it; the relay owns provider
 * credentials. Nothing here logs the token or the shared secret.
 */

export type MobilePlatform = "ios" | "android" | "unifiedpush" | "mobile";

export interface PushRelayConfig {
  /** Base URL of the relay, e.g. `https://push.aulora.app`. */
  readonly url: string;
  /** Shared bearer secret the relay checks. */
  readonly token: string;
  /** Stable opaque id for this server, echoed back to the app. */
  readonly serverId: string;
}

/** One device to wake. `token` is an APNs/FCM token or a UnifiedPush endpoint. */
export interface MobilePushTarget {
  readonly platform: MobilePlatform;
  readonly token: string;
}

export interface WakePayload {
  readonly kind: "message" | "call";
  readonly serverId: string;
  readonly channelId: string;
  readonly messageId: string;
  readonly platform: MobilePlatform;
  readonly token: string;
}

export interface WakeResult {
  readonly ok: boolean;
  readonly status: number;
}

export const WAKE_PATH = "/v1/wake";

/** Reads relay configuration from the deployment environment, or `null`. */
export function pushRelayConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): PushRelayConfig | null {
  const url = env.PUSH_RELAY_URL?.trim();
  const token = env.PUSH_RELAY_TOKEN?.trim();
  if (url === undefined || token === undefined || url.length === 0 || token.length === 0) {
    return null;
  }
  const serverId =
    env.AULORA_SERVER_ID?.trim() || env.SITE_URL?.trim() || env.CONVEX_SITE_URL?.trim() || "aulora";
  return { url: url.replace(/\/+$/, ""), token, serverId };
}

export interface SendWakeDeps {
  readonly fetch?: typeof fetch;
}

/**
 * Sends one content-free wake to the relay. Errors are returned, never thrown,
 * so one failing device cannot fail a message send or a batch.
 */
export async function sendWake(
  payload: WakePayload,
  config: PushRelayConfig,
  deps: SendWakeDeps = {},
): Promise<WakeResult> {
  const fetchImpl = deps.fetch ?? fetch;
  const body = {
    v: 1,
    kind: payload.kind,
    serverId: payload.serverId,
    channelId: payload.channelId,
    messageId: payload.messageId,
    platform: payload.platform,
    token: payload.token,
  };
  try {
    const response = await fetchImpl(`${config.url}${WAKE_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(body),
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
