import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStuckTimeout, STUCK_TIMEOUT_MS } from "../src/lib/stuck-timeout";

describe("createStuckTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is not stuck until the timeout elapses", () => {
    const timer = createStuckTimeout();
    timer.start();

    expect(timer.isStuck()).toBe(false);
    vi.advanceTimersByTime(STUCK_TIMEOUT_MS - 1);
    expect(timer.isStuck()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(timer.isStuck()).toBe(true);
  });

  it("notifies subscribers when it becomes stuck and when it stops", () => {
    const timer = createStuckTimeout();
    const onChange = vi.fn();
    timer.subscribe(onChange);

    timer.start();
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(STUCK_TIMEOUT_MS);
    expect(onChange).toHaveBeenCalledTimes(1);

    timer.stop();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(timer.isStuck()).toBe(false);
  });

  it("restarts the countdown when started again", () => {
    const timer = createStuckTimeout(500);
    timer.start();
    vi.advanceTimersByTime(400);
    timer.start();

    vi.advanceTimersByTime(400);
    expect(timer.isStuck()).toBe(false);
    vi.advanceTimersByTime(100);
    expect(timer.isStuck()).toBe(true);
  });

  it("clears a stuck state immediately on stop", () => {
    const timer = createStuckTimeout(100);
    timer.start();
    vi.advanceTimersByTime(100);
    expect(timer.isStuck()).toBe(true);

    timer.stop();
    expect(timer.isStuck()).toBe(false);
    // A cleared timer must not fire later.
    vi.advanceTimersByTime(1000);
    expect(timer.isStuck()).toBe(false);
  });
});
