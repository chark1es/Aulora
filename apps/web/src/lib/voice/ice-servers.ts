import type { TurnCredentials } from "@aulora/core";

/**
 * ICE server assembly for the peer mesh.
 *
 * A self-hosted deployment may point calls at its own TURN relay. The relay
 * never receives a long-lived password: the backend mints a time-limited
 * username/credential pair (RFC 5766), and this module merges that pair with
 * whatever `AULORA_ICE_SERVERS` already configured. Everything here is pure
 * except {@link IceServerSource}, which owns the pre-expiry refresh timer.
 */

/** Seconds before a credential expires when the client asks for a new one. */
export const TURN_REFRESH_MARGIN_SECONDS = 300;

/** Retry delay after a failed refresh, so a down backend is not hammered. */
export const TURN_RETRY_SECONDS = 60;

function urlsOf(server: RTCIceServer): readonly string[] {
  const urls = server.urls as string | readonly string[];
  return typeof urls === "string" ? [urls] : urls;
}

/**
 * Appends the ephemeral TURN server to the deployment's configured ICE
 * servers. A configured URL that the ephemeral credential also covers is
 * dropped first: the time-limited credential is the more specific grant, and
 * two entries for one URL would make the browser try both credentials.
 */
export function mergeIceServers(
  base: readonly RTCIceServer[],
  turn: TurnCredentials | null,
): RTCIceServer[] {
  if (turn === null || turn.urls.length === 0) {
    return [...base];
  }
  const turnUrls = new Set(turn.urls);
  const kept = base.filter((server) => !urlsOf(server).some((url) => turnUrls.has(url)));
  return [
    ...kept,
    {
      urls: [...turn.urls],
      username: turn.username,
      credential: turn.credential,
    } as RTCIceServer,
  ];
}

export interface IceServerSourceOptions {
  /** The deployment override (`AULORA_ICE_SERVERS`), read lazily. */
  readonly base: () => readonly RTCIceServer[];
  /** `null` when the deployment has no TURN server. */
  readonly fetchTurn: () => Promise<TurnCredentials | null>;
  /** Called after credentials change so new peers pick them up immediately. */
  readonly onChange?: () => void;
  /** Injectable clock, in milliseconds; tests pin it. */
  readonly now?: () => number;
}

/**
 * Fetches one call's TURN credential and refreshes it before it expires. A
 * failed fetch keeps the previous credential (it may still be valid) and only
 * affects peers created before the next successful refresh.
 */
export class IceServerSource {
  private turn: TurnCredentials | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private generation = 0;
  private readonly now: () => number;

  constructor(private readonly options: IceServerSourceOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  /** The ICE server list a new `RTCPeerConnection` should use. */
  current(): readonly RTCIceServer[] {
    return mergeIceServers(this.options.base(), this.turn);
  }

  /** Starts fetching; safe to call more than once for the same call. */
  async load(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    await this.refresh();
  }

  /** Drops the credential and the refresh timer at the end of a call. */
  dispose(): void {
    this.generation += 1;
    this.clearTimer();
    this.turn = null;
    this.started = false;
  }

  private async refresh(): Promise<void> {
    const generation = this.generation;
    try {
      const turn = await this.options.fetchTurn();
      if (generation !== this.generation) {
        return;
      }
      this.turn = turn;
      if (turn === null) {
        // No relay here: nothing to refresh.
        return;
      }
      this.options.onChange?.();
      // Refresh a little before the relay stops accepting the credential. The
      // server's absolute expiry caps the TTL when a retry landed late; a clock
      // that disagrees cannot push the refresh past the credential's own TTL.
      const remaining = turn.expiresAt - Math.floor(this.now() / 1000);
      const delay = Math.max(
        60,
        Math.min(turn.ttlSeconds, remaining) - TURN_REFRESH_MARGIN_SECONDS,
      );
      this.schedule(delay);
    } catch {
      if (generation !== this.generation) {
        return;
      }
      this.schedule(TURN_RETRY_SECONDS);
    }
  }

  private schedule(seconds: number): void {
    this.clearTimer();
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (generation === this.generation) {
        void this.refresh();
      }
    }, seconds * 1000);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
