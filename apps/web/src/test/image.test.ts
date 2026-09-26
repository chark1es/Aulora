import { describe, expect, it } from "vitest";
import { fitWithin, isProcessableImage, outputMimeFor } from "../lib/image";

describe("image preparation helpers", () => {
  it("scales down preserving aspect ratio", () => {
    expect(fitWithin(4000, 2000, 1000)).toEqual({ width: 1000, height: 500 });
    expect(fitWithin(2000, 4000, 1000)).toEqual({ width: 500, height: 1000 });
  });

  it("never upscales and never returns a zero dimension", () => {
    expect(fitWithin(100, 80, 1000)).toEqual({ width: 100, height: 80 });
    expect(fitWithin(0, 0, 1000)).toEqual({ width: 1, height: 1 });
  });

  it("keeps PNG for transparency and JPEG otherwise", () => {
    expect(outputMimeFor("image/png")).toBe("image/png");
    expect(outputMimeFor("image/jpeg")).toBe("image/jpeg");
    expect(outputMimeFor("image/webp")).toBe("image/jpeg");
  });

  it("only claims to process raster image types", () => {
    expect(isProcessableImage("image/png")).toBe(true);
    expect(isProcessableImage("image/heic")).toBe(false);
    expect(isProcessableImage("application/pdf")).toBe(false);
  });
});
