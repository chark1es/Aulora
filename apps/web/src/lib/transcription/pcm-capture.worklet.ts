import { PcmCapture } from "./pcm";

/**
 * AudioWorklet that taps the participant's already-processed microphone stream
 * and hands back 16 kHz mono PCM16 frames. It runs on the audio thread, so it
 * keeps working while the tab is hidden. The gate starts closed: until the main
 * thread opens it, samples are discarded and nothing is posted.
 */

declare const sampleRate: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}

declare function registerProcessor(
  name: string,
  processor: new (
    options?: unknown,
  ) => AudioWorkletProcessor & {
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
  },
): void;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private readonly capture = new PcmCapture(sampleRate);
  private open = false;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data as { readonly type?: string; readonly open?: boolean } | null;
      if (data !== null && data.type === "gate") {
        this.open = data.open === true;
        if (!this.open) {
          this.capture.reset();
        }
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!this.open || input === undefined || input.length === 0) {
      return true;
    }
    for (const frame of this.capture.push(input)) {
      this.port.postMessage(frame, [frame]);
    }
    return true;
  }
}

registerProcessor("aulora-pcm-capture", PcmCaptureProcessor);
