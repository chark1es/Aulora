import { describe, expect, it, vi } from "vitest";
import { watchLocalQuery } from "../src/watch-local-query";

describe("watchLocalQuery", () => {
  it("emits a warm cached value immediately", () => {
    const onChange = vi.fn();
    const handle = { localQueryResult: () => 42, onUpdate: () => () => undefined };
    watchLocalQuery(handle, onChange);
    expect(onChange).toHaveBeenCalledWith(42);
  });

  it("stays quiet until the first value arrives", () => {
    const onChange = vi.fn();
    let listener: () => void = () => undefined;
    const handle = {
      localQueryResult: () => undefined as number | undefined,
      onUpdate: (next: () => void): (() => void) => {
        listener = next;
        return () => undefined;
      },
    };
    watchLocalQuery(handle, onChange);
    expect(onChange).not.toHaveBeenCalled();
    handle.localQueryResult = () => 7;
    listener();
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("unsubscribes through the returned function", () => {
    const unsubscribe = vi.fn();
    const handle = { localQueryResult: () => 1, onUpdate: () => unsubscribe };
    const stop = watchLocalQuery(handle, () => undefined);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
