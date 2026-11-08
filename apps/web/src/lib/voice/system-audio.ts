import { type AudioStreamHeader, startAudioCapture, stopAudioCapture } from "./desktop-display";

/**
 * Turns the shell's PCM stream into a live audio track.
 *
 * The shell captures the machine's audio (WASAPI loopback, ScreenCaptureKit
 * audio, or a PulseAudio monitor) and sends 20 ms chunks of interleaved f32 over
 * a Tauri channel. An AudioWorklet plays them into a
 * `MediaStreamAudioDestinationNode`, whose track is what the call publishes:
 *
 *   channel → Float32Array → worklet ring buffer (resample to the context rate,
 *   drop the oldest on overrun) → destination → MediaStreamTrack
 *
 * The worklet module is a bundled file served from the app's own origin, because
 * the shell's CSP allows `script-src 'self'` only (no blob: or inline module).
 */

/** Processor name registered by `public/worklets/pcm-playback.js`. */
export const PCM_WORKLET = "aulora-pcm";

/** Where Vite serves the bundled worklet. Same origin, so the CSP allows it. */
export function workletUrl(baseUrl: string = import.meta.env.BASE_URL): string {
  return `${baseUrl}worklets/pcm-playback.js`;
}

export interface SystemAudioCapture {
  /** The live system-audio track; hint it `music`, never `speech`. */
  readonly track: MediaStreamTrack;
  /** Stops the shell's capture, the worklet and the context. Idempotent. */
  stop(): void;
}

export interface SystemAudioDeps {
  /** Opens the capture; the shell by default. */
  readonly startCapture?: (onPcm: (pcm: Float32Array) => void) => Promise<AudioStreamHeader>;
  readonly stopCapture?: () => Promise<void>;
  readonly createContext?: () => AudioContext;
  /** Loads the worklet module; tests replace this instead of running one. */
  readonly loadWorklet?: (context: AudioContext) => Promise<void>;
}

/** Loads the bundled worklet from the app origin. */
async function loadBundledWorklet(context: AudioContext): Promise<void> {
  await context.audioWorklet.addModule(workletUrl());
}

/**
 * Starts a system-audio track for `sourceId`.
 *
 * Chunks that arrive before the header (the backend starts emitting while the
 * command is still returning) are held until the worklet knows the rate, so no
 * audio is dropped or played at the wrong speed. Throws when the platform or the
 * backend refuses; the caller degrades to a video-only share.
 */
export async function openSystemAudioStream(
  sourceId: string | null,
  deps: SystemAudioDeps = {},
): Promise<SystemAudioCapture> {
  const createContext = deps.createContext ?? (() => new AudioContext());
  const loadWorklet = deps.loadWorklet ?? loadBundledWorklet;
  const startCapture = deps.startCapture ?? ((onPcm) => startAudioCapture(sourceId, onPcm));
  const stopCapture = deps.stopCapture ?? stopAudioCapture;

  const context = createContext();
  let node: AudioWorkletNode | null = null;
  let destination: MediaStreamAudioDestinationNode | null = null;
  let track: MediaStreamTrack | null = null;
  let stopped = false;

  const cleanup = () => {
    node?.port.postMessage({ type: "flush" });
    node?.disconnect();
    destination?.disconnect();
    track?.stop();
    void stopCapture().catch(() => undefined);
    void context.close().catch(() => undefined);
  };

  try {
    await loadWorklet(context);
    // A capture may start from a gesture that already happened (the picker's
    // Share button), but autoplay rules still need the context resumed.
    if (context.state === "suspended") {
      await context.resume();
    }
    node = new AudioWorkletNode(context, PCM_WORKLET, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    destination = context.createMediaStreamDestination();
    node.connect(destination);
    const first = destination.stream.getAudioTracks()[0];
    if (first === undefined) {
      throw new Error("The audio pipeline did not produce a track.");
    }
    track = first;

    let announced = false;
    const queued: Float32Array[] = [];
    const post = (pcm: Float32Array) => {
      node?.port.postMessage({ type: "pcm", pcm }, [pcm.buffer]);
    };
    const header = await startCapture((pcm) => {
      if (announced) {
        post(pcm);
        return;
      }
      queued.push(pcm);
    });

    node.port.postMessage({
      type: "header",
      sampleRate: header.sampleRate,
      channels: header.channels,
    });
    announced = true;
    for (const pcm of queued) {
      post(pcm);
    }

    const audio = track;
    audio.contentHint = "music";
    return {
      track: audio,
      stop() {
        if (stopped) {
          return;
        }
        stopped = true;
        cleanup();
      },
    };
  } catch (error) {
    if (!stopped) {
      stopped = true;
      cleanup();
    }
    throw error;
  }
}
