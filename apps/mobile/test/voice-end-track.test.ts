import { describe, expect, it, vi } from "vitest";
import { endTrack, type VoiceTrack } from "../src/lib/voice/webrtc";

function track(release?: () => void): VoiceTrack {
  return { kind: "video", enabled: true, stop: vi.fn(), ...(release ? { release } : {}) };
}

describe("endTrack", () => {
  it("stops the track and releases its native capturer", () => {
    const release = vi.fn();
    const screen = track(release);
    endTrack(screen);
    expect(screen.stop).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("copes with a track that has no release and with no track at all", () => {
    const plain = track();
    expect(() => {
      endTrack(plain);
      endTrack(null);
    }).not.toThrow();
    expect(plain.stop).toHaveBeenCalledOnce();
  });
});
