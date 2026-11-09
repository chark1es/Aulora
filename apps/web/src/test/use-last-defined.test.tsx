import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useLastDefined } from "../lib/use-last-defined";

describe("useLastDefined", () => {
  it("keeps the last value when the query reports undefined again", () => {
    const { result, rerender } = renderHook(({ value }) => useLastDefined(value), {
      initialProps: { value: { member: "u1" } as { member: string } | undefined },
    });
    expect(result.current).toEqual({ member: "u1" });

    rerender({ value: undefined });
    expect(result.current).toEqual({ member: "u1" });
  });

  it("updates to the newest defined value", () => {
    const { result, rerender } = renderHook(({ value }) => useLastDefined(value), {
      initialProps: { value: 1 as number | undefined },
    });
    rerender({ value: 2 });
    expect(result.current).toBe(2);
  });

  it("has no value before the first answer", () => {
    const { result } = renderHook(() => useLastDefined<number>(undefined));
    expect(result.current).toBeUndefined();
  });
});
