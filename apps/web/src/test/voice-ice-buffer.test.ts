import { afterEach, describe, expect, it, vi } from "vitest";
import { ICE_BATCH_LIMIT, ICE_COALESCE_MS, IceSignalBuffer } from "../lib/voice/ice-buffer";

describe("IceSignalBuffer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pools a gather burst into one send", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const buffer = new IceSignalBuffer(send);
    buffer.add("them", "a");
    buffer.add("them", "b");
    buffer.add("them", "c");
    expect(send).not.toHaveBeenCalled();

    vi.advanceTimersByTime(ICE_COALESCE_MS);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("them", ["a", "b", "c"]);
  });

  it("keeps peers in separate batches", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const buffer = new IceSignalBuffer(send);
    buffer.add("one", "a");
    buffer.add("two", "b");
    vi.advanceTimersByTime(ICE_COALESCE_MS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith("one", ["a"]);
    expect(send).toHaveBeenCalledWith("two", ["b"]);
  });

  it("sends immediately at the batch limit and starts a new batch", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const buffer = new IceSignalBuffer(send);
    for (let index = 0; index < ICE_BATCH_LIMIT; index += 1) {
      buffer.add("them", String(index));
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1]).toHaveLength(ICE_BATCH_LIMIT);

    buffer.add("them", "later");
    vi.advanceTimersByTime(ICE_COALESCE_MS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith("them", ["later"]);
  });

  it("drops a closed peer's batch without sending it", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const buffer = new IceSignalBuffer(send);
    buffer.add("them", "a");
    buffer.drop("them");
    vi.advanceTimersByTime(ICE_COALESCE_MS);
    expect(send).not.toHaveBeenCalled();
    expect(() => buffer.flush("them")).not.toThrow();
  });

  it("clears every peer at the end of a call", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const buffer = new IceSignalBuffer(send);
    buffer.add("one", "a");
    buffer.add("two", "b");
    buffer.clear();
    vi.advanceTimersByTime(ICE_COALESCE_MS);
    expect(send).not.toHaveBeenCalled();
  });
});
