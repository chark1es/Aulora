import type { CaptureHandle, OpenCapture } from "./capture";
import {
  backoffMs,
  buildAuthFrame,
  CONFLICT_MESSAGE,
  classifyClose,
  END_FRAME,
  IDLE_RECONNECT_WINDOW_MS,
  MAX_CONFLICT_FAILURES,
  MAX_CONSECUTIVE_FAILURES,
  MAX_IDLE_RECONNECTS,
  parseServerMessage,
  REPLACED_MESSAGE,
  transcribeSocketUrl,
} from "./protocol";

/** The slice of `WebSocket` the streamer uses, so tests can fake it. */
export interface SocketLike {
  binaryType: string;
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: ((event: { readonly code: number }) => void) | null;
  onerror: (() => void) | null;
  send(data: string | ArrayBuffer): void;
  close(code?: number): void;
}

export interface MintedToken {
  readonly token: string;
  readonly wsPath: string;
}

export type StreamStatus =
  /** Not streaming: transcription is off, or this participant has opted out. */
  | { readonly kind: "idle" }
  | { readonly kind: "connecting" }
  /** Connected and sending, or ready to send whenever the microphone is live. */
  | { readonly kind: "streaming"; readonly sending: boolean }
  | { readonly kind: "reconnecting"; readonly attempt: number }
  | {
      readonly kind: "error";
      readonly message: string;
      /** Paused because another tab or device holds the stream; Resume takes over. */
      readonly resumable?: true;
    };

/** What the streamer should be doing right now. */
export interface StreamTarget {
  /** A transcription session is running in this call. */
  readonly active: boolean;
  /** The participant opted out of sending their own audio. */
  readonly optedOut: boolean;
  /** The microphone is live: not muted, deafened, or waiting on push-to-talk. */
  readonly transmitting: boolean;
  readonly stream: MediaStream | null;
}

export interface StreamerDeps {
  readonly origin: string;
  readonly mintToken: () => Promise<MintedToken>;
  readonly createSocket: (url: string) => SocketLike;
  readonly openCapture: OpenCapture;
  readonly onStatus: (status: StreamStatus) => void;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly random?: () => number;
}

const SOCKET_OPEN = 1;
/** Frames kept while the socket (re)connects: about two seconds of speech. */
const PENDING_FRAME_LIMIT = 20;
/** How long the capture graph survives a mute before it is torn down. */
const CAPTURE_LINGER_MS = 3_000;
/** A connection that lasts this long counts as healthy and resets the backoff. */
const HEALTHY_MS = 10_000;

/**
 * Streams the participant's own microphone to the transcriber.
 *
 * It never decides who the speaker is: identity comes from the token Convex
 * mints for this participant. Audio is only tapped while `active && !optedOut`
 * and the microphone is live; mute, push-to-talk release, opt-out, the end of
 * the session and `stop()` all close the gate immediately, and the capture graph
 * itself is destroyed after a short linger (or at once for opt-out and stop).
 */
export class TranscriptionStreamer {
  private target: StreamTarget = {
    active: false,
    optedOut: false,
    transmitting: false,
    stream: null,
  };
  private socket: SocketLike | null = null;
  private ready = false;
  private connecting = false;
  private capture: CaptureHandle | null = null;
  private capturing: Promise<void> | null = null;
  private captureStream: MediaStream | null = null;
  private gateOpen = false;
  private lingerTimer: unknown = null;
  private retryTimer: unknown = null;
  private failures = 0;
  /** Consecutive "already streaming" closes, counted separately from drops. */
  private conflicts = 0;
  /**
   * The error is "another device holds the stream": unlike a fatal error it
   * clears when the microphone goes live again, so the person can retry.
   */
  private conflictPaused = false;
  private wasLive = false;
  /** The server ended this session's stream (4411); nothing more is sent until it is over here too. */
  private sessionEnded = false;
  /** Times of recent on-demand reconnects after a normal close (storm breaker). */
  private idleReconnects: number[] = [];
  private connectedAt = 0;
  private pending: ArrayBuffer[] = [];
  private epoch = 0;
  private stopped = false;
  private status: StreamStatus = { kind: "idle" };

  /** The site origin for the next connect; may change while the streamer lives. */
  private origin: string;
  /** The last failure was an unusable origin: a new origin retries, nothing else does. */
  private addressUnavailable = false;

  constructor(private readonly deps: StreamerDeps) {
    this.origin = deps.origin;
  }

  /**
   * Points the next connect at a new site origin (on desktop it can change from
   * empty to the workspace URL after mount). An open socket is left alone. If
   * the stream was stopped for lack of a usable origin, it starts again now.
   */
  setOrigin(origin: string): void {
    this.origin = origin;
    if (this.stopped || !this.addressUnavailable || this.status.kind !== "error") {
      return;
    }
    this.addressUnavailable = false;
    this.publish({ kind: "idle" });
    this.update(this.target);
  }

  private setTimer(callback: () => void, ms: number): unknown {
    return (this.deps.setTimer ?? ((cb, delay) => setTimeout(cb, delay)))(callback, ms);
  }

  private clearTimer(handle: unknown): void {
    (this.deps.clearTimer ?? ((value) => clearTimeout(value as never)))(handle);
  }

  private publish(status: StreamStatus): void {
    const same = JSON.stringify(status) === JSON.stringify(this.status);
    this.status = status;
    if (!same) {
      this.deps.onStatus(status);
    }
  }

  /** Applies a new target. Cheap to call on every render-level change. */
  update(target: StreamTarget): void {
    if (this.stopped) {
      return;
    }
    this.target = target;
    const streaming = target.active && !target.optedOut;
    const live = target.transmitting && target.stream !== null;
    const wentLive = live && !this.wasLive;
    this.wasLive = live;
    if (!streaming) {
      this.teardown("idle");
      return;
    }
    if (this.sessionEnded) {
      // The server said the session is over; the roster catches up shortly.
      return;
    }
    if (this.status.kind === "error") {
      if (this.conflictPaused && wentLive) {
        // A fresh unmute / push-to-talk press is a new attempt after a conflict pause.
        this.clearConflictPause();
      } else {
        // A fatal error stays until the target stops being streamed.
        return;
      }
    }
    if (live) {
      this.cancelLinger();
      void this.ensureCapture();
      this.ensureSocket();
    } else {
      this.closeGate();
    }
    if (this.socket !== null && this.ready) {
      this.publish({ kind: "streaming", sending: live });
    }
  }

  private clearConflictPause(): void {
    this.conflictPaused = false;
    this.failures = 0;
    this.conflicts = 0;
    this.idleReconnects = [];
    this.publish({ kind: "idle" });
  }

  /**
   * An explicit "take over" after pausing because another tab or device holds
   * the stream (the Resume button). Does nothing in any other state.
   */
  resume(): void {
    if (this.stopped || !this.conflictPaused || this.status.kind !== "error") {
      return;
    }
    this.clearConflictPause();
    this.update(this.target);
  }

  /** Ends everything for good; the instance cannot be reused. */
  stop(): void {
    this.teardown("idle");
    this.stopped = true;
  }

  // ---- Capture -------------------------------------------------------------

  private async ensureCapture(): Promise<void> {
    const stream = this.target.stream;
    if (stream === null) {
      return;
    }
    if (this.capture !== null && this.captureStream === stream) {
      this.setGate(true);
      return;
    }
    if (this.capture !== null) {
      this.destroyCapture();
    }
    if (this.capturing !== null) {
      return;
    }
    const epoch = this.epoch;
    this.capturing = (async () => {
      try {
        const handle = await this.deps.openCapture(stream, (frame) => {
          this.onFrame(frame);
        });
        const wanted =
          epoch === this.epoch &&
          !this.stopped &&
          this.target.active &&
          !this.target.optedOut &&
          this.target.stream === stream;
        if (!wanted) {
          handle.stop();
          return;
        }
        this.capture = handle;
        this.captureStream = stream;
        this.gateOpen = false;
        this.setGate(this.target.transmitting);
      } catch {
        if (epoch === this.epoch) {
          this.fail("Your microphone could not be captured for transcription.");
        }
      } finally {
        this.capturing = null;
      }
    })();
    await this.capturing;
  }

  private setGate(open: boolean): void {
    if (this.capture !== null && this.gateOpen !== open) {
      this.gateOpen = open;
      this.capture.setGate(open);
    }
  }

  private closeGate(): void {
    this.setGate(false);
    this.pending = [];
    if (this.capture !== null && this.lingerTimer === null) {
      this.lingerTimer = this.setTimer(() => {
        this.lingerTimer = null;
        this.destroyCapture();
      }, CAPTURE_LINGER_MS);
    }
  }

  private cancelLinger(): void {
    if (this.lingerTimer !== null) {
      this.clearTimer(this.lingerTimer);
      this.lingerTimer = null;
    }
  }

  private destroyCapture(): void {
    this.cancelLinger();
    this.capture?.stop();
    this.capture = null;
    this.captureStream = null;
  }

  private onFrame(frame: ArrayBuffer): void {
    const live = this.target.active && !this.target.optedOut && this.target.transmitting;
    if (!live) {
      return;
    }
    if (this.socket !== null && this.ready && this.socket.readyState === SOCKET_OPEN) {
      this.socket.send(frame);
      return;
    }
    this.pending.push(frame);
    if (this.pending.length > PENDING_FRAME_LIMIT) {
      this.pending.shift();
    }
  }

  // ---- Socket --------------------------------------------------------------

  private ensureSocket(): void {
    if (this.socket !== null || this.connecting || this.retryTimer !== null) {
      return;
    }
    void this.connect();
  }

  private async connect(): Promise<void> {
    const epoch = this.epoch;
    this.connecting = true;
    this.publish(
      this.failures > 0 ? { kind: "reconnecting", attempt: this.failures } : { kind: "connecting" },
    );
    try {
      const minted = await this.deps.mintToken();
      if (epoch !== this.epoch || this.stopped) {
        return;
      }
      const url = transcribeSocketUrl(this.origin, minted.wsPath);
      if (url === null) {
        this.addressUnavailable = true;
        this.fail("Transcription is not available from this address.");
        return;
      }
      const socket = this.deps.createSocket(url);
      socket.binaryType = "arraybuffer";
      this.socket = socket;
      this.ready = false;
      socket.onopen = () => {
        if (epoch === this.epoch && this.socket === socket) {
          socket.send(buildAuthFrame(minted.token));
        }
      };
      socket.onmessage = (event) => {
        if (epoch !== this.epoch || this.socket !== socket) {
          return;
        }
        if (parseServerMessage(event.data).type === "ready") {
          this.onReady(socket);
        }
      };
      socket.onerror = () => {
        // The close event that follows carries the code; nothing to do here.
      };
      socket.onclose = (event) => {
        if (epoch === this.epoch && this.socket === socket) {
          this.onClosed(event.code);
        }
      };
    } catch {
      if (epoch === this.epoch && !this.stopped) {
        this.scheduleRetry();
      }
    } finally {
      if (epoch === this.epoch) {
        this.connecting = false;
      }
    }
  }

  private onReady(socket: SocketLike): void {
    this.ready = true;
    this.connectedAt = Date.now();
    const live = this.target.transmitting && this.target.stream !== null;
    this.publish({ kind: "streaming", sending: live });
    const frames = this.pending;
    this.pending = [];
    if (live) {
      for (const frame of frames) {
        socket.send(frame);
      }
    }
  }

  private onClosed(code: number): void {
    const wasHealthy = this.ready && Date.now() - this.connectedAt >= HEALTHY_MS;
    this.socket = null;
    this.ready = false;
    if (wasHealthy) {
      this.failures = 0;
    }
    const action = classifyClose(code);
    if (wasHealthy) {
      this.conflicts = 0;
    }
    if (action.kind === "retry" && action.conflict === true) {
      this.conflicts += 1;
    }
    if (action.kind === "stop") {
      this.fail(action.reason);
      return;
    }
    if (action.kind === "ended") {
      // Over for this socket: stop capturing, say nothing alarming, never reconnect.
      this.sessionEnded = true;
      this.closeSocket(false);
      this.destroyCapture();
      this.pending = [];
      this.publish({ kind: "idle" });
      return;
    }
    if (action.kind === "replaced") {
      // A newer connection for this participant took over. Never reconnect on
      // our own: that would evict it in turn and the two would trade the stream
      // forever. Pause until the person explicitly takes over again.
      this.conflictPaused = true;
      this.fail(REPLACED_MESSAGE);
      return;
    }
    if (action.kind === "idle") {
      // The server ended an idle stream: reconnect only when audio is needed.
      this.publish({ kind: "streaming", sending: false });
      if (this.target.transmitting && this.target.stream !== null) {
        if (this.reconnectStorm()) {
          this.conflictPaused = true;
          this.fail(CONFLICT_MESSAGE);
          return;
        }
        this.ensureSocket();
      }
      return;
    }
    this.scheduleRetry();
  }

  /** Records an on-demand reconnect; true when there have been too many lately. */
  private reconnectStorm(): boolean {
    const now = Date.now();
    this.idleReconnects = this.idleReconnects.filter((at) => now - at < IDLE_RECONNECT_WINDOW_MS);
    this.idleReconnects.push(now);
    return this.idleReconnects.length > MAX_IDLE_RECONNECTS;
  }

  private scheduleRetry(): void {
    this.failures += 1;
    if (this.conflicts > MAX_CONFLICT_FAILURES) {
      // Two devices keep displacing each other: stop and say so, rather than loop.
      this.conflictPaused = true;
      this.fail(CONFLICT_MESSAGE);
      return;
    }
    if (this.failures > MAX_CONSECUTIVE_FAILURES) {
      this.fail("Transcription could not stay connected. Your audio is not being transcribed.");
      return;
    }
    this.publish({ kind: "reconnecting", attempt: this.failures });
    const delay = backoffMs(this.failures - 1, this.deps.random);
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      const stillWanted =
        this.target.active && !this.target.optedOut && !this.stopped && this.socket === null;
      if (stillWanted && this.target.transmitting) {
        void this.connect();
      } else if (stillWanted) {
        this.publish({ kind: "streaming", sending: false });
      }
    }, delay);
  }

  private fail(message: string): void {
    this.closeSocket(false);
    this.destroyCapture();
    this.pending = [];
    this.publish(
      this.conflictPaused
        ? { kind: "error", message, resumable: true }
        : { kind: "error", message },
    );
  }

  private closeSocket(graceful: boolean): void {
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    if (this.retryTimer !== null) {
      this.clearTimer(this.retryTimer);
      this.retryTimer = null;
    }
    if (socket === null) {
      return;
    }
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      if (graceful && socket.readyState === SOCKET_OPEN) {
        socket.send(END_FRAME);
      }
      socket.close(1000);
    } catch {
      // Already closing.
    }
  }

  /** Stops capturing and closes the socket; the new status is `next`. */
  private teardown(next: "idle"): void {
    this.epoch += 1;
    this.closeSocket(true);
    this.destroyCapture();
    this.pending = [];
    this.failures = 0;
    this.conflicts = 0;
    this.conflictPaused = false;
    this.sessionEnded = false;
    this.idleReconnects = [];
    this.addressUnavailable = false;
    this.connecting = false;
    this.publish({ kind: next });
  }
}
