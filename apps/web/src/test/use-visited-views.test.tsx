import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useVisitedViews } from "../lib/use-visited-views";

describe("useVisitedViews", () => {
  it("starts with the active view", () => {
    const { result } = renderHook(() => useVisitedViews("chat"));
    expect([...result.current]).toEqual(["chat"]);
  });

  it("keeps views after the reader switches away", () => {
    const { result, rerender } = renderHook(({ view }: { view: string }) => useVisitedViews(view), {
      initialProps: { view: "chat" },
    });

    rerender({ view: "notes" });
    expect([...result.current].sort()).toEqual(["chat", "notes"]);

    rerender({ view: "chat" });
    expect([...result.current].sort()).toEqual(["chat", "notes"]);
  });

  it("returns the same set while the active view is already visited", () => {
    const { result, rerender } = renderHook(({ view }: { view: string }) => useVisitedViews(view), {
      initialProps: { view: "chat" },
    });
    const first = result.current;

    rerender({ view: "chat" });
    expect(result.current).toBe(first);
  });
});
