import { TRANSCRIBER_IDLE_TIMEOUT_MS } from "@aulora/core";

/**
 * The client side of the transcriber WebSocket protocol (see
 * `docs/call-addons-api.md`): auth frame first, binary PCM after `ready`,
 * `end` to flush. Nothing here touches the network.
 */

export const END_FRAME = JSON.stringify({ type: "end" });

/** The first text frame, sent within five seconds of opening the socket. */
export function buildAuthFrame(token: string): string {
  return JSON.stringify({ type: "auth", token });
}

/**
 * `wss://<site>/transcribe/ws` for a site origin and the minted `wsPath`
 * (`/transcribe/`). Returns `null` for an origin that is not http(s), so a
 * malformed value can never turn into some other scheme.
 */
export function transcribeSocketUrl(origin: string, wsPath: string): string | null {
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    return null;
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    return null;
  }
  const path = `/${wsPath.replace(/^\/+|\/+$/gu, "")}/ws`.replace(/^\/\//u, "/");
  const scheme = base.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${base.host}${path}`;
}

export type ServerMessage =
  | { readonly type: "ready"; readonly sessionId: string; readonly speakerKey: string }
  | { readonly type: "other" };

/** Parses a text frame from the server; anything unrecognised is `other`. */
export function parseServerMessage(data: unknown): ServerMessage {
  if (typeof data !== "string") {
    return { type: "other" };
  }
  try {
    const value = JSON.parse(data) as Record<string, unknown>;
    if (
      value.type === "ready" &&
      typeof value.sessionId === "string" &&
      typeof value.speakerKey === "string"
    ) {
      return { type: "ready", sessionId: value.sessionId, speakerKey: value.speakerKey };
    }
  } catch {
    // Not JSON: ignore.
  }
  return { type: "other" };
}

export type CloseAction =
  /** Expected end or idle timeout: reconnect only when audio is next needed. */
  | { readonly kind: "idle" }
  /**
   * Transient: mint a fresh token and try again with backoff. `conflict` marks
   * "this identity is already streaming" (4429): the server evicts the older
   * stream for a newer valid token, so a retry normally succeeds, but two
   * devices can displace each other, so it gets a tighter attempt budget.
   */
  | { readonly kind: "retry"; readonly conflict?: true }
  /**
   * The transcriber closed this socket because a newer connection for the same
   * participant took over (4410). Terminal for this socket: reconnecting would
   * evict the newer one in turn and two tabs would replace each other forever.
   * Only an explicit action (unmute, push-to-talk, Resume) takes over again.
   */
  | { readonly kind: "replaced" }
  /**
   * The transcription session is over for this socket (4411): the server
   * permanently rejected the audio (session ended, speaker removed). Not an
   * error to show: stop capturing and do not reconnect.
   */
  | { readonly kind: "ended" }
  /** Do not retry; tell the person why. */
  | { readonly kind: "stop"; readonly reason: string };

/** Maps a WebSocket close code to what the streamer should do next. */
export function classifyClose(code: number): CloseAction {
  switch (code) {
    case 1000:
      return { kind: "idle" };
    case 4400:
      return { kind: "stop", reason: "The transcriber rejected the audio format." };
    case 4401:
    case 4408:
    case 1011:
      return { kind: "retry" };
    case 4410:
      return { kind: "replaced" };
    case 4411:
      return { kind: "ended" };
    case 4429:
      return { kind: "retry", conflict: true };
    case 4503:
      return { kind: "stop", reason: "No speech model is ready on the server." };
    default:
      // 1006 and every other abnormal closure is a dropped connection.
      return { kind: "retry" };
  }
}

/** Consecutive failures after which the streamer gives up and reports an error. */
export const MAX_CONSECUTIVE_FAILURES = 8;

/**
 * Consecutive "already streaming" closes (4429) after which the streamer pauses
 * instead of fighting another device or tab for the stream.
 */
export const MAX_CONFLICT_FAILURES = 4;

/** Shown when a newer connection for the same participant replaced this one (4410). */
export const REPLACED_MESSAGE =
  "Your speech is being transcribed from another device or tab, so this one paused. Unmute or press Resume to take over.";

/**
 * Reconnect-storm breaker: more than this many on-demand reconnects after a
 * normal close within the window means something keeps closing the stream, so
 * the streamer pauses instead of looping.
 */
export const MAX_IDLE_RECONNECTS = 5;
export const IDLE_RECONNECT_WINDOW_MS = 30_000;

/** Shown when the retries ran out because another device keeps taking the stream. */
export const CONFLICT_MESSAGE =
  "Your audio is also being transcribed from another device or tab, so this one paused. Unmute to try again.";

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;

/**
 * Exponential backoff with jitter: 1 s, 2 s, 4 s … capped at 30 s, scaled by a
 * random factor in [0.5, 1) so many clients do not reconnect in lockstep.
 * `random` is injectable for tests.
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const exponential = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
  return Math.round(exponential * (0.5 + random() * 0.5));
}

/** The server closes a silent socket after this long; the client reconnects on demand. */
export const SERVER_IDLE_TIMEOUT_MS = TRANSCRIBER_IDLE_TIMEOUT_MS;
