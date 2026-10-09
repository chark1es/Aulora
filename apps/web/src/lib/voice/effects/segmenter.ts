/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import wasmLoaderUrl from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryUrl from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import modelUrl from "../../../assets/models/selfie_segmenter_landscape.tflite?url";

/**
 * Person segmentation with MediaPipe's selfie model (Apache-2.0, 250 KB), run in
 * WebAssembly on the GPU where it can and on the CPU where it cannot. The model
 * sees a small 256x144 picture and returns, for each of those pixels, how likely
 * it is to belong to the person in front of the camera.
 */
export const SEGMENT_WIDTH = 256;
export const SEGMENT_HEIGHT = 144;
const MASK_SIZE = SEGMENT_WIDTH * SEGMENT_HEIGHT;

/**
 * The MediaPipe runtime, bundled as hashed assets on the app's own origin. Only
 * the SIMD build is shipped: every browser that can run the call UI supports
 * WebAssembly SIMD, and the fallback build would double the download. Naming the
 * two files directly (rather than a CDN base path) keeps `script-src 'self'`,
 * works offline and in the desktop app, and means a call never fetches code from
 * a third party.
 */
const RUNTIME = { wasmLoaderPath: wasmLoaderUrl, wasmBinaryPath: wasmBinaryUrl };

export interface Segmenter {
  /**
   * Returns the person mask for a 256x144 picture as 0..255 values, or `null`
   * when the model produced nothing. The array is reused between calls.
   */
  segment(picture: HTMLCanvasElement | OffscreenCanvas, timestampMs: number): Uint8Array | null;
  close(): void;
}

type Vision = typeof import("@mediapipe/tasks-vision");

async function build(vision: Vision, delegate: "GPU" | "CPU") {
  return await vision.ImageSegmenter.createFromOptions(RUNTIME, {
    baseOptions: { modelAssetPath: modelUrl, delegate },
    runningMode: "VIDEO",
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
}

/** A 0..1 confidence as a 0..255 byte. */
function toByte(confidence: number): number {
  return Math.round(Math.min(1, Math.max(0, confidence)) * 255);
}

export async function createSegmenter(): Promise<Segmenter> {
  const vision = await import("@mediapipe/tasks-vision");
  let model: Awaited<ReturnType<typeof build>>;
  try {
    model = await build(vision, "GPU");
  } catch {
    // No usable WebGL for MediaPipe: the CPU path is slower but works.
    model = await build(vision, "CPU");
  }
  const mask = new Uint8Array(MASK_SIZE);
  return {
    segment(picture, timestampMs) {
      const outcome = { produced: false };
      model.segmentForVideo(picture, timestampMs, (result) => {
        // The selfie model has one output: the chance each pixel is the person.
        const values = result.confidenceMasks?.at(-1)?.getAsFloat32Array();
        if (values === undefined) {
          return;
        }
        if (values.length === MASK_SIZE) {
          for (let index = 0; index < MASK_SIZE; index += 1) {
            mask[index] = toByte(values[index] ?? 0);
          }
          outcome.produced = true;
        }
      });
      return outcome.produced ? mask : null;
    },
    close() {
      model.close();
    },
  };
}

/**
 * Blends each new mask into the last one so a pixel on the edge of the person
 * does not flicker between frames. Writes into `previous` and returns it.
 */
export function smoothMask(previous: Uint8Array, next: Uint8Array, weight = 0.6): Uint8Array {
  // Written in place: this runs every frame, so no second array is allocated.
  for (let index = 0; index < previous.length; index += 1) {
    const before = previous[index] ?? 0;
    const target = next[index] ?? before;
    previous[index] = Math.round(before + (target - before) * weight);
  }
  return previous;
}
