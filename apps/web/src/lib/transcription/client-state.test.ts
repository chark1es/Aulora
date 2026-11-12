import { describe, expect, it, vi } from "vitest";
import { TranscriptionClientStore } from "./client-state";

describe("TranscriptionClientStore", () => {
  it("starts in the notice phase, opted in, when a session begins", () => {
    const store = new TranscriptionClientStore();
    store.setSession("s1");
    expect(store.getSnapshot()).toMatchObject({
      sessionId: "s1",
      phase: "notice",
      optedOut: false,
    });
  });

  it("remembers an opt-out for that session only", () => {
    const store = new TranscriptionClientStore();
    store.setSession("s1");
    store.setOptedOut(true);
    expect(store.getSnapshot().optedOut).toBe(true);
    // A re-render with the same session keeps the choice.
    store.setSession("s1");
    expect(store.getSnapshot().optedOut).toBe(true);
    store.setSession("s2");
    expect(store.getSnapshot().optedOut).toBe(false);
    store.setSession(null);
    expect(store.getSnapshot().phase).toBe("off");
    store.setSession("s1");
    expect(store.getSnapshot().optedOut).toBe(false);
  });

  it("ignores changes with no session and notifies only on real changes", () => {
    const store = new TranscriptionClientStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setOptedOut(true);
    store.setPhase("live");
    expect(listener).not.toHaveBeenCalled();
    store.setSession("s1");
    store.setStream({ kind: "connecting" });
    store.setStream({ kind: "connecting" });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
