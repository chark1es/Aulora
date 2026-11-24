/** What this device knows about the call it is in, for end-of-transcription detection. */
export interface TranscriptionCallSnapshot {
  readonly transcribing: boolean;
  readonly sessionId: string | null;
}

export interface TranscriptionEndStep {
  /** The session to remember for the next step (null once it has ended). */
  readonly tracked: string | null;
  /** Set on the step where a tracked session has just ended. */
  readonly ended: string | null;
}

/**
 * Pure transition for "a transcription ended while this device was in the
 * call". `call` is null when this device is not in a call (it left, or the call
 * ended). A session counts as ended when it was tracked and the call no longer
 * reports it as running: transcription stopped, a different session replaced
 * it, or this device left while it was on.
 */
export function nextTranscriptionEnd(
  tracked: string | null,
  call: TranscriptionCallSnapshot | null,
): TranscriptionEndStep {
  if (call?.transcribing && call.sessionId === null) {
    // Running but the id has not arrived yet: nothing has ended.
    return { tracked, ended: null };
  }
  const current = call?.transcribing ? call.sessionId : null;
  if (current !== null) {
    return { tracked: current, ended: tracked !== null && tracked !== current ? tracked : null };
  }
  return { tracked: null, ended: tracked };
}
