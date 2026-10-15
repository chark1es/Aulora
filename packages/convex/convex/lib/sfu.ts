import { SignJWT } from "jose";

/**
 * Access to the optional streaming server (a LiveKit SFU).
 *
 * Aulora's calls are peer-to-peer by default. A screen or window stream sent to
 * many viewers is the one case where that stops scaling (the sharer uploads one
 * copy per viewer), so a workspace may run a LiveKit server and route streams
 * through it. The backend only mints short-lived room tokens; it never touches
 * the media. Without configuration every client keeps using the mesh.
 */
export interface SfuConfig {
  readonly url: string;
  readonly apiKey: string;
  readonly apiSecret: string;
}

/** A token is only checked when a client connects, so this bounds how long a removed member could rejoin. */
export const SFU_TOKEN_TTL_SECONDS = 60 * 60;

/** Screen capture only: the server never carries a microphone or camera from this grant. */
const PUBLISH_SOURCES = ["screen_share", "screen_share_audio"] as const;

/** Reads the deployment's streaming server settings; `null` when any is missing or malformed. */
export function readSfuConfig(env: Record<string, string | undefined>): SfuConfig | null {
  const url = env.LIVEKIT_URL?.trim() ?? "";
  const apiKey = env.LIVEKIT_API_KEY?.trim() ?? "";
  const apiSecret = env.LIVEKIT_API_SECRET?.trim() ?? "";
  if (url.length === 0 || apiKey.length === 0 || apiSecret.length === 0) {
    return null;
  }
  if (!/^wss?:\/\//i.test(url)) {
    return null;
  }
  return { url, apiKey, apiSecret };
}

/** One room per call, so a stream is only ever visible to that call's participants. */
export function sfuRoomName(callId: string): string {
  return `call_${callId}`;
}

export interface SfuTokenInput {
  readonly config: SfuConfig;
  readonly callId: string;
  readonly identity: string;
  readonly canPublish: boolean;
  /** Seconds since the epoch; injectable so tests are deterministic. */
  readonly now?: number;
}

/** Signs a LiveKit access token (HS256 JWT with a `video` grant). */
export async function signSfuToken(input: SfuTokenInput): Promise<string> {
  const issuedAt = input.now ?? Math.floor(Date.now() / 1000);
  return await new SignJWT({
    video: {
      room: sfuRoomName(input.callId),
      roomJoin: true,
      canSubscribe: true,
      canPublish: input.canPublish,
      canPublishData: false,
      canUpdateOwnMetadata: false,
      ...(input.canPublish ? { canPublishSources: [...PUBLISH_SOURCES] } : {}),
    },
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(input.config.apiKey)
    .setSubject(input.identity)
    .setNotBefore(issuedAt)
    .setExpirationTime(issuedAt + SFU_TOKEN_TTL_SECONDS)
    .sign(new TextEncoder().encode(input.config.apiSecret));
}
