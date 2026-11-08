import { SignJWT } from "jose";

/**
 * Access to the optional streaming server (a LiveKit SFU).
 *
 * Aulora's calls are peer-to-peer by default. Two cases stop scaling on a mesh:
 * a screen or window stream sent to many viewers (the sharer uploads one copy
 * per viewer), and audio plus camera in a larger call (every client encodes and
 * uploads one copy per peer). A workspace that runs LiveKit may route either
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

/**
 * The call transport keeps one long-lived connection for a whole call, so its
 * token is minted for longer and re-minted by the client before it expires.
 */
export const SFU_CALL_TOKEN_TTL_SECONDS = 4 * 60 * 60;

/** Screen capture only for the default grant. */
const SCREEN_PUBLISH_SOURCES = ["screen_share", "screen_share_audio"] as const;

/** Media the call transport publishes; the caller may narrow this further. */
const CALL_PUBLISH_SOURCES = ["microphone", "camera"] as const;

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

/**
 * A separate room for the call's microphone and camera. Keeping it apart from
 * the screen-share room means a device can hold both connections (a distinct
 * participant identity is not needed) and neither subscribes to the other's
 * media.
 */
export function sfuCallRoomName(callId: string): string {
  return `call_${callId}_media`;
}

export type SfuTokenScope = "screen" | "call";

export interface SfuTokenInput {
  readonly config: SfuConfig;
  readonly callId: string;
  readonly identity: string;
  readonly canPublish: boolean;
  /** Defaults to `screen`, the original screen-share grant. */
  readonly scope?: SfuTokenScope;
  /** Overrides the scope's default lifetime, in seconds. */
  readonly ttlSeconds?: number;
  /** Narrow the publishable sources; ignored when `canPublish` is false. */
  readonly canPublishSources?: readonly string[];
  /** Seconds since the epoch; injectable so tests are deterministic. */
  readonly now?: number;
}

/** Signs a LiveKit access token (HS256 JWT with a `video` grant). */
export async function signSfuToken(input: SfuTokenInput): Promise<string> {
  const issuedAt = input.now ?? Math.floor(Date.now() / 1000);
  const scope = input.scope ?? "screen";
  const ttlSeconds =
    input.ttlSeconds ?? (scope === "call" ? SFU_CALL_TOKEN_TTL_SECONDS : SFU_TOKEN_TTL_SECONDS);
  const sources = input.canPublish
    ? [
        ...(input.canPublishSources ??
          (scope === "call" ? [...CALL_PUBLISH_SOURCES] : [...SCREEN_PUBLISH_SOURCES])),
      ]
    : [];
  return await new SignJWT({
    video: {
      room: scope === "call" ? sfuCallRoomName(input.callId) : sfuRoomName(input.callId),
      roomJoin: true,
      canSubscribe: true,
      canPublish: input.canPublish,
      canPublishData: false,
      canUpdateOwnMetadata: false,
      ...(sources.length > 0 ? { canPublishSources: sources } : {}),
    },
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(input.config.apiKey)
    .setSubject(input.identity)
    .setNotBefore(issuedAt)
    .setExpirationTime(issuedAt + ttlSeconds)
    .sign(new TextEncoder().encode(input.config.apiSecret));
}
