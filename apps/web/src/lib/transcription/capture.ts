import { audioContextCtor } from "../voice/audio-context";
import workletUrl from "./pcm-capture.worklet.ts?worker&url";

/** A running tap on a microphone stream. */
export interface CaptureHandle {
  /** Opens or closes the gate; a closed gate discards audio on the audio thread. */
  setGate(open: boolean): void;
  stop(): void;
}

export type OpenCapture = (
  stream: MediaStream,
  onFrame: (frame: ArrayBuffer) => void,
) => Promise<CaptureHandle>;

/**
 * Taps `stream` (the same processed stream the call sends to peers) with a
 * private AudioContext and the PCM worklet. The tap is never connected to the
 * speakers: its output goes through a zero-gain node only so the browser keeps
 * pulling audio through it.
 */
export const openPcmCapture: OpenCapture = async (stream, onFrame) => {
  const Ctor = audioContextCtor();
  if (Ctor === null || typeof AudioWorkletNode === "undefined") {
    throw new Error("This browser cannot capture audio for transcription.");
  }
  const context = new Ctor({ latencyHint: "interactive" });
  try {
    await context.audioWorklet.addModule(workletUrl);
    void context.resume().catch(() => undefined);
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "aulora-pcm-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const silence = context.createGain();
    silence.gain.value = 0;
    node.port.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data instanceof ArrayBuffer) {
        onFrame(event.data);
      }
    };
    source.connect(node);
    node.connect(silence);
    silence.connect(context.destination);
    return {
      setGate(open) {
        node.port.postMessage({ type: "gate", open });
      },
      stop() {
        node.port.onmessage = null;
        node.port.postMessage({ type: "gate", open: false });
        source.disconnect();
        node.disconnect();
        silence.disconnect();
        void context.close().catch(() => undefined);
      },
    };
  } catch (error) {
    void context.close().catch(() => undefined);
    throw error;
  }
};
