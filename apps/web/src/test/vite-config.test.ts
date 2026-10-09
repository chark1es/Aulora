import { describe, expect, it } from "vitest";
import { keepLoadableAssetsAsFiles } from "../../vite.config";

describe("asset inlining", () => {
  it("never inlines an audio worklet, WebAssembly module or model as a data URL", () => {
    // A data: script is refused by the production CSP, which would silently
    // disable the noise gate and input volume.
    expect(keepLoadableAssetsAsFiles("/pkg/dist/noiseGate/workletProcessor.js")).toBe(false);
    expect(keepLoadableAssetsAsFiles("/pkg/rnnoise.wasm")).toBe(false);
    expect(keepLoadableAssetsAsFiles("/models/selfie.tflite")).toBe(false);
    expect(keepLoadableAssetsAsFiles("/pkg/worker.mjs?url")).toBe(false);
  });

  it("leaves everything else to Vite's default rule", () => {
    expect(keepLoadableAssetsAsFiles("/img/logo.svg")).toBeUndefined();
    expect(keepLoadableAssetsAsFiles("/img/photo.png")).toBeUndefined();
    expect(keepLoadableAssetsAsFiles("/fonts/inter.woff2")).toBeUndefined();
  });
});
