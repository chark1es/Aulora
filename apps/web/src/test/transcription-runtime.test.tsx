import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTICE_GRACE_MS, TranscriptionRuntime } from "../components/voice/TranscriptionRuntime";
import { transcriptionClient } from "../lib/transcription/client-state";
import type { StreamTarget } from "../lib/transcription/streamer";

const streamer = vi.hoisted(() => ({
  updates: [] as { active: boolean; optedOut: boolean; transmitting: boolean }[],
  stops: 0,
}));

vi.mock("../lib/transcription/streamer", () => ({
  TranscriptionStreamer: class {
    update(target: StreamTarget) {
      streamer.updates.push({
        active: target.active,
        optedOut: target.optedOut,
        transmitting: target.transmitting,
      });
    }
    setOrigin() {}
    resume() {}
    stop() {
      streamer.stops += 1;
    }
  },
}));

const mint = vi.fn();
const mic = {} as MediaStream;

function runtime(sessionId: string | null, transmitting = true) {
  return (
    <TranscriptionRuntime
      sessionId={sessionId}
      micStream={mic}
      transmitting={transmitting}
      origin="https://chat.example.com"
      mint={mint}
    />
  );
}

const last = () => streamer.updates.at(-1);

beforeEach(() => {
  vi.useFakeTimers();
  streamer.updates.length = 0;
  streamer.stops = 0;
  transcriptionClient.setSession(null);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("TranscriptionRuntime", () => {
  it("sends no audio until the notice has been up for the grace period", () => {
    const view = render(runtime(null));
    expect(last()?.active).toBe(false);
    view.rerender(runtime("s1"));
    expect(last()?.active).toBe(false);
    act(() => {
      vi.advanceTimersByTime(NOTICE_GRACE_MS - 1);
    });
    expect(streamer.updates.every((update) => !update.active)).toBe(true);
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(last()?.active).toBe(true);
  });

  it("starts a fresh grace period for a new session, and none is skipped by a reconnect", () => {
    const view = render(runtime("s1"));
    act(() => {
      vi.advanceTimersByTime(NOTICE_GRACE_MS + 10);
    });
    expect(last()?.active).toBe(true);
    // Muting and unmuting inside the same session never re-opens a grace period.
    view.rerender(runtime("s1", false));
    view.rerender(runtime("s1", true));
    expect(last()).toMatchObject({ active: true, transmitting: true });
    // A different session shows the notice again and holds audio back.
    view.rerender(runtime("s2"));
    expect(last()?.active).toBe(false);
    act(() => {
      vi.advanceTimersByTime(NOTICE_GRACE_MS + 10);
    });
    expect(last()?.active).toBe(true);
  });

  it("stops capture at once when the session ends, and never streams an opted-out session", () => {
    const view = render(runtime("s1"));
    act(() => {
      vi.advanceTimersByTime(NOTICE_GRACE_MS + 10);
    });
    expect(last()?.active).toBe(true);
    act(() => {
      transcriptionClient.setOptedOut(true);
    });
    expect(last()).toMatchObject({ active: true, optedOut: true });
    view.rerender(runtime(null));
    expect(last()?.active).toBe(false);
    view.unmount();
    expect(streamer.stops).toBeGreaterThan(0);
  });
});
