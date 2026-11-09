import { useSyncExternalStore } from "react";
import type { StreamStatus } from "./streamer";

/**
 * What this device is doing about the call's transcription, shared between the
 * runtime that streams audio and the notice that lets the person opt out.
 *
 * - `notice`: a session is running and the notice is showing, but this device
 *   has not started sending audio yet (a short grace to read it and opt out).
 * - `live`: audio may be sent whenever the microphone is live.
 */
export type TranscriptionPhase = "off" | "notice" | "live";

export interface TranscriptionClientState {
  readonly sessionId: string | null;
  readonly phase: TranscriptionPhase;
  /** The person chose not to send their own audio for this session. */
  readonly optedOut: boolean;
  readonly stream: StreamStatus;
}

const OFF: TranscriptionClientState = {
  sessionId: null,
  phase: "off",
  optedOut: false,
  stream: { kind: "idle" },
};

type Listener = () => void;

/** A tiny external store; one runtime per page owns it. */
export class TranscriptionClientStore {
  private state: TranscriptionClientState = OFF;
  private readonly listeners = new Set<Listener>();
  private readonly resumeListeners = new Set<Listener>();
  /** The session the person last opted out of, so a new session starts opted in. */
  private optedOutSession: string | null = null;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Called when the person presses Resume to take the stream back from another tab. */
  onResume = (listener: Listener): (() => void) => {
    this.resumeListeners.add(listener);
    return () => {
      this.resumeListeners.delete(listener);
    };
  };

  requestResume(): void {
    for (const listener of this.resumeListeners) {
      listener();
    }
  }

  getSnapshot = (): TranscriptionClientState => this.state;

  private set(next: TranscriptionClientState): void {
    if (
      next.sessionId === this.state.sessionId &&
      next.phase === this.state.phase &&
      next.optedOut === this.state.optedOut &&
      JSON.stringify(next.stream) === JSON.stringify(this.state.stream)
    ) {
      return;
    }
    this.state = next;
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Follows the call: a session id starts the notice, `null` clears everything. */
  setSession(sessionId: string | null): void {
    if (sessionId === null) {
      this.optedOutSession = null;
      this.set(OFF);
      return;
    }
    if (sessionId === this.state.sessionId) {
      return;
    }
    this.set({
      sessionId,
      phase: "notice",
      optedOut: this.optedOutSession === sessionId,
      stream: { kind: "idle" },
    });
  }

  setPhase(phase: TranscriptionPhase): void {
    if (this.state.sessionId !== null) {
      this.set({ ...this.state, phase });
    }
  }

  setStream(stream: StreamStatus): void {
    this.set({ ...this.state, stream });
  }

  setOptedOut(optedOut: boolean): void {
    if (this.state.sessionId === null) {
      return;
    }
    this.optedOutSession = optedOut ? this.state.sessionId : null;
    this.set({ ...this.state, optedOut });
  }
}

/** The store for the call on this page. */
export const transcriptionClient = new TranscriptionClientStore();

export function useTranscriptionClient(): TranscriptionClientState {
  return useSyncExternalStore(
    transcriptionClient.subscribe,
    transcriptionClient.getSnapshot,
    transcriptionClient.getSnapshot,
  );
}
