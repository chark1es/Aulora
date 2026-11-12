import { useEffect, useRef } from "react";
import { openPcmCapture } from "../../lib/transcription/capture";
import { transcriptionClient } from "../../lib/transcription/client-state";
import {
  type MintedToken,
  type StreamStatus,
  TranscriptionStreamer,
} from "../../lib/transcription/streamer";
import { openWebSocket } from "../../lib/transcription/web-socket";

/** Time the notice is on screen before this device starts sending audio. */
export const NOTICE_GRACE_MS = 3_000;

export interface TranscriptionRuntimeProps {
  /** The running transcription session of the call, or `null` when there is none. */
  readonly sessionId: string | null;
  /** The call’s processed microphone stream. */
  readonly micStream: MediaStream | null;
  /** The microphone is live (not muted, deafened or awaiting push-to-talk). */
  readonly transmitting: boolean;
  /** Site origin for the WebSocket; empty when unknown. */
  readonly origin: string;
  /** Mints a short-lived audio token for the session. */
  readonly mint: (sessionId: string) => Promise<MintedToken>;
}

/**
 * Streams this participant’s microphone to the transcriber while their call is
 * being transcribed. Renders nothing. It shows the notice first (a short grace),
 * honours the person’s opt-out, and stops on mute, leave or the end of the
 * session. Used for members (inside the voice provider) and for the guest page.
 */
export function TranscriptionRuntime(props: TranscriptionRuntimeProps) {
  const { sessionId, micStream, transmitting, origin, mint } = props;
  const mintRef = useRef(mint);
  mintRef.current = mint;
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;
  const streamerRef = useRef<TranscriptionStreamer | null>(null);
  const originRef = useRef(origin);
  originRef.current = origin;

  // One streamer for the life of the runtime; it is told what to do below. It must
  // not be rebuilt (and the session dropped) when only the origin changes.
  useEffect(() => {
    const streamer = new TranscriptionStreamer({
      origin: originRef.current,
      mintToken: async () => {
        const id = sessionRef.current;
        if (id === null) {
          throw new Error("No transcription session");
        }
        return await mintRef.current(id);
      },
      createSocket: openWebSocket,
      openCapture: openPcmCapture,
      onStatus: (status: StreamStatus) => {
        transcriptionClient.setStream(status);
      },
    });
    streamerRef.current = streamer;
    const offResume = transcriptionClient.onResume(() => {
      streamer.resume();
    });
    return () => {
      offResume();
      streamer.stop();
      streamerRef.current = null;
      transcriptionClient.setSession(null);
    };
  }, []);

  // A new origin only changes where the next connect goes.
  useEffect(() => {
    streamerRef.current?.setOrigin(origin);
  }, [origin]);

  // The session id drives the notice and the grace period.
  useEffect(() => {
    transcriptionClient.setSession(sessionId);
    if (sessionId === null) {
      return;
    }
    const timer = setTimeout(() => {
      transcriptionClient.setPhase("live");
    }, NOTICE_GRACE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [sessionId]);

  // Push the target to the streamer whenever any input, or the person’s choice, changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the session id is a trigger; the effect reads it through the store
  useEffect(() => {
    let seen = "";
    const apply = (force: boolean) => {
      const state = transcriptionClient.getSnapshot();
      // Stream-status changes also notify; only the inputs below matter here.
      const key = `${state.sessionId ?? ""}|${state.phase}|${state.optedOut}`;
      if (!force && key === seen) {
        return;
      }
      seen = key;
      streamerRef.current?.update({
        active: sessionRef.current !== null && state.phase === "live",
        optedOut: state.optedOut,
        transmitting,
        stream: micStream,
      });
    };
    apply(true);
    return transcriptionClient.subscribe(() => {
      apply(false);
    });
  }, [sessionId, micStream, transmitting]);

  return null;
}
