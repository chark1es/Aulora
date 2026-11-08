import { describe, expect, it } from "vitest";
import { choosePipTransport, createFrameClock, PIP_FRAME_FPS } from "../lib/voice/pip-frames";

describe("createFrameClock", () => {
  it("allows at most the frame rate, never a burst", () => {
    const clock = createFrameClock(PIP_FRAME_FPS);
    expect(clock.due(0)).toBe(true);
    expect(clock.due(10)).toBe(false);
    expect(clock.due(66)).toBe(false);
    expect(clock.due(67)).toBe(true);
  });

  it("does not catch up after a slow encode", () => {
    const clock = createFrameClock(15);
    expect(clock.due(0)).toBe(true);
    expect(clock.due(500)).toBe(true);
    expect(clock.due(501)).toBe(false);
  });

  it("reads the clock by default, which is what the interval uses", () => {
    const clock = createFrameClock(15, () => 42);
    expect(clock.due()).toBe(true);
    expect(clock.due()).toBe(false);
  });
});

describe("choosePipTransport", () => {
  const base = {
    loopbackSupported: true,
    framesSupported: true,
    loopbackConnected: false,
    loopbackFailed: false,
    elapsedMs: 0,
  };

  it("keeps the live connection once it is up, even if frames are possible", () => {
    expect(choosePipTransport({ ...base, loopbackConnected: true, elapsedMs: 9_000 })).toBe(
      "loopback",
    );
  });

  it("is still trying the loopback before the timeout", () => {
    expect(choosePipTransport({ ...base, elapsedMs: 1_000 })).toBe("loopback");
  });

  it("falls back to frames when the loopback failed or timed out", () => {
    expect(choosePipTransport({ ...base, loopbackFailed: true })).toBe("frames");
    expect(choosePipTransport({ ...base, elapsedMs: 4_000 })).toBe("frames");
  });

  it("falls back to frames when the webview has no peer connections", () => {
    expect(choosePipTransport({ ...base, loopbackSupported: false })).toBe("frames");
  });

  it("keeps avatars when neither transport can work", () => {
    expect(choosePipTransport({ ...base, loopbackSupported: false, framesSupported: false })).toBe(
      "avatars",
    );
    expect(choosePipTransport({ ...base, loopbackFailed: true, framesSupported: false })).toBe(
      "avatars",
    );
  });

  it("never waits longer than the stated timeout by default", () => {
    expect(choosePipTransport({ ...base, elapsedMs: 3_999 })).toBe("loopback");
    expect(choosePipTransport({ ...base, elapsedMs: 4_000 })).toBe("frames");
  });
});
