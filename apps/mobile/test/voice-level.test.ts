import { describe, expect, it } from "vitest";
import { extractAudioLevel } from "../src/lib/voice/webrtc";

describe("extractAudioLevel", () => {
  it("reads the audio level from a stats map or object", () => {
    expect(extractAudioLevel(new Map([["inbound", { audioLevel: 0.4 }]]))).toBe(0.4);
    expect(extractAudioLevel({ inbound: { audioLevel: 0.25 } })).toBe(0.25);
  });

  it("picks the highest level and clamps to 0..1", () => {
    expect(
      extractAudioLevel(
        new Map([
          ["a", { audioLevel: 0.2 }],
          ["b", { audioLevel: 1.8 }],
        ]),
      ),
    ).toBe(1);
    expect(extractAudioLevel(new Map([["a", { audioLevel: -0.5 }]]))).toBe(0);
  });

  it("returns null when no numeric level is present", () => {
    expect(extractAudioLevel(undefined)).toBeNull();
    expect(extractAudioLevel({ a: null })).toBeNull();
    expect(extractAudioLevel({ a: { audioLevel: "loud" } })).toBeNull();
  });
});
