/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { BackgroundBlur } from "@aulora/core";
import { renderBackdrop } from "./backdrop";
import { Compositor } from "./compositor";
import {
  createSegmenter,
  SEGMENT_HEIGHT,
  SEGMENT_WIDTH,
  type Segmenter,
  smoothMask,
} from "./segmenter";

/**
 * Blurs or replaces the background behind a person on a camera track and hands
 * back a new track to send in its place.
 *
 * Where the browser has insertable streams (Chromium, which includes the Windows
 * desktop app) frames are pulled from the camera track and pushed to a generated
 * one, so the work is driven by frames arriving, not by a display refresh, and
 * keeps going while the call is in a picture-in-picture window or another tab.
 * Elsewhere a hidden video element feeds a canvas that is captured as a track.
 */
export type EffectOptions =
  | { readonly mode: "blur"; readonly blur: BackgroundBlur }
  | { readonly mode: "image"; readonly image: string; readonly blur: BackgroundBlur };

export interface BackgroundEffect {
  /** The processed camera track to send. */
  readonly track: MediaStreamTrack;
  update(options: EffectOptions): void;
  stop(): void;
}

/** Output is capped here: the encoder scales down anyway, and the GPU time grows with area. */
const MAX_WIDTH = 1280;
/** A frame slower than this (ms) makes the effect segment every other frame. */
const SLOW_FRAME_MS = 36;
const FAST_FRAME_MS = 18;

interface TrackProcessorConstructor {
  new (init: {
    track: MediaStreamTrack;
    maxBufferSize?: number;
  }): {
    readonly readable: ReadableStream<VideoFrame>;
  };
}
interface TrackGeneratorConstructor {
  new (init: {
    kind: "video";
  }): MediaStreamTrack & { readonly writable: WritableStream<VideoFrame> };
}

function insertableStreams(): {
  Processor: TrackProcessorConstructor;
  Generator: TrackGeneratorConstructor;
} | null {
  const scope = globalThis as {
    MediaStreamTrackProcessor?: TrackProcessorConstructor;
    MediaStreamTrackGenerator?: TrackGeneratorConstructor;
  };
  if (
    scope.MediaStreamTrackProcessor === undefined ||
    scope.MediaStreamTrackGenerator === undefined
  ) {
    return null;
  }
  return { Processor: scope.MediaStreamTrackProcessor, Generator: scope.MediaStreamTrackGenerator };
}

/** Whether this browser can run background effects at all. */
export function backgroundEffectsSupported(): boolean {
  if (typeof document === "undefined" || typeof WebAssembly === "undefined") {
    return false;
  }
  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

function fitWithin(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_WIDTH / Math.max(1, width));
  // Even sizes: video encoders reject odd dimensions.
  return {
    width: Math.max(2, Math.round((width * scale) / 2) * 2),
    height: Math.max(2, Math.round((height * scale) / 2) * 2),
  };
}

/** Segments each frame and draws it over the backdrop. */
class Renderer {
  private readonly picture: HTMLCanvasElement;
  private readonly pictureContext: CanvasRenderingContext2D;
  private readonly mask = new Uint8Array(SEGMENT_WIDTH * SEGMENT_HEIGHT).fill(255);
  private hasMask = false;
  private frames = 0;
  private every = 1;
  private average = 0;
  private lastTimestamp = 0;
  private size = { width: 0, height: 0 };

  constructor(
    private readonly segmenter: Segmenter,
    readonly compositor: Compositor,
    private readonly onResize: (width: number, height: number) => void,
  ) {
    this.picture = document.createElement("canvas");
    this.picture.width = SEGMENT_WIDTH;
    this.picture.height = SEGMENT_HEIGHT;
    const context = this.picture.getContext("2d", { willReadFrequently: false });
    if (context === null) {
      throw new Error("A 2D canvas is not available");
    }
    this.pictureContext = context;
  }

  render(frame: TexImageSource & CanvasImageSource, width: number, height: number): void {
    const started = performance.now();
    const next = fitWithin(width, height);
    if (next.width !== this.size.width || next.height !== this.size.height) {
      this.size = next;
      this.compositor.resize(next.width, next.height);
      this.onResize(next.width, next.height);
    }
    if (this.frames % this.every === 0) {
      this.segment(frame);
    }
    this.frames += 1;
    this.compositor.draw(frame, this.mask);
    this.adapt(performance.now() - started);
  }

  private segment(frame: CanvasImageSource): void {
    this.pictureContext.drawImage(frame, 0, 0, SEGMENT_WIDTH, SEGMENT_HEIGHT);
    // MediaPipe needs strictly increasing timestamps in video mode.
    this.lastTimestamp = Math.max(this.lastTimestamp + 1, Math.round(performance.now()));
    const result = this.segmenter.segment(this.picture, this.lastTimestamp);
    if (result === null) {
      return;
    }
    if (this.hasMask) {
      smoothMask(this.mask, result);
    } else {
      this.mask.set(result);
      this.hasMask = true;
    }
  }

  /** Backs off to every other frame on a slow machine, and recovers when it speeds up. */
  private adapt(elapsed: number): void {
    this.average = this.average === 0 ? elapsed : this.average * 0.9 + elapsed * 0.1;
    if (this.average > SLOW_FRAME_MS) {
      this.every = 2;
    } else if (this.average < FAST_FRAME_MS) {
      this.every = 1;
    }
  }

  close(): void {
    this.segmenter.close();
    this.compositor.dispose();
  }
}

interface Driver {
  readonly track: MediaStreamTrack;
  stop(): void;
}

/** Chromium: read frames from the camera track and write them to a generated one. */
function streamDriver(
  streams: NonNullable<ReturnType<typeof insertableStreams>>,
  source: MediaStreamTrack,
  canvas: HTMLCanvasElement,
  renderer: Renderer,
  onFailure: (error: unknown) => void,
): Driver {
  const processor = new streams.Processor({ track: source, maxBufferSize: 1 });
  const generator = new streams.Generator({ kind: "video" });
  const reader = processor.readable.getReader();
  const writer = generator.writable.getWriter();
  let stopped = false;
  const pump = async () => {
    while (!stopped) {
      const next = await reader.read();
      if (next.done) {
        return;
      }
      const frame = next.value;
      try {
        renderer.render(frame, frame.displayWidth, frame.displayHeight);
        await writer.write(new VideoFrame(canvas, { timestamp: frame.timestamp }));
      } finally {
        frame.close();
      }
    }
  };
  void pump().catch((error: unknown) => {
    if (!stopped) {
      onFailure(error);
    }
  });
  return {
    track: generator,
    stop() {
      stopped = true;
      void reader.cancel().catch(() => undefined);
      void writer.close().catch(() => undefined);
      generator.stop();
    },
  };
}

/** Everywhere else: a hidden video element feeds the canvas, which is captured as a track. */
async function canvasDriver(
  source: MediaStreamTrack,
  canvas: HTMLCanvasElement,
  renderer: Renderer,
): Promise<Driver> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([source]);
  await video.play();
  let stopped = false;
  const schedule = (tick: () => void) => {
    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(tick);
    } else {
      setTimeout(tick, 33);
    }
  };
  const tick = () => {
    if (stopped) {
      return;
    }
    if (video.readyState >= 2 && video.videoWidth > 0) {
      renderer.render(video, video.videoWidth, video.videoHeight);
    }
    schedule(tick);
  };
  schedule(tick);
  const track = canvas.captureStream(30).getVideoTracks()[0];
  if (track === undefined) {
    throw new Error("The canvas produced no video track");
  }
  return {
    track,
    stop() {
      stopped = true;
      video.srcObject = null;
      track.stop();
    },
  };
}

/**
 * Starts an effect on `source`. Rejects when the browser cannot run it (no WebGL 2
 * or WebAssembly, or the model failed to load) so the caller can keep the plain
 * camera. The caller still owns `source`.
 */
export async function createBackgroundEffect(
  source: MediaStreamTrack,
  options: EffectOptions,
  onFailure: (error: unknown) => void = () => undefined,
): Promise<BackgroundEffect> {
  const segmenter = await createSegmenter();
  const canvas = document.createElement("canvas");
  let current = options;
  let size = { width: 2, height: 2 };
  let stopped = false;
  let compositor: Compositor;
  try {
    compositor = new Compositor(canvas);
  } catch (error) {
    segmenter.close();
    throw error;
  }
  const apply = async () => {
    if (current.mode === "blur") {
      compositor.setBackdrop({ kind: "blur", strength: current.blur });
      return;
    }
    const image = await renderBackdrop(current.image, size.width, size.height);
    if (!stopped) {
      compositor.setBackdrop(
        image === null ? { kind: "blur", strength: current.blur } : { kind: "image", image },
      );
    }
  };
  const renderer = new Renderer(segmenter, compositor, (width, height) => {
    size = { width, height };
    void apply();
  });
  await apply();
  const streams = insertableStreams();
  let driver: Driver;
  try {
    driver =
      streams !== null
        ? streamDriver(streams, source, canvas, renderer, onFailure)
        : await canvasDriver(source, canvas, renderer);
  } catch (error) {
    renderer.close();
    throw error;
  }
  const stop = () => {
    if (!stopped) {
      stopped = true;
      driver.stop();
      renderer.close();
    }
  };
  source.addEventListener("ended", stop);
  return {
    track: driver.track,
    update(next) {
      current = next;
      void apply();
    },
    stop,
  };
}
