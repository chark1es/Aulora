import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MAX_RETAINED_VIEWS, useVisitedViews } from "../lib/use-visited-views";

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

  it("evicts the oldest surface so live subscriptions stay bounded", () => {
    const { result, rerender } = renderHook(({ view }: { view: string }) => useVisitedViews(view), {
      initialProps: { view: "chat" },
    });
    for (const view of ["notes", "kanban", "scheduled", "transcripts"]) {
      rerender({ view });
    }
    // Only the most recent surfaces remain mounted; the first ones unmount and
    // release their queries instead of living until session teardown.
    expect(result.current.size).toBe(MAX_RETAINED_VIEWS);
    expect(result.current.has("chat")).toBe(false);
    expect(result.current.has("notes")).toBe(false);
    expect([...result.current]).toEqual(["scheduled", "transcripts"]);

    // Revisiting a retained view keeps it without growing the set.
    rerender({ view: "scheduled" });
    expect([...result.current].sort()).toEqual(["scheduled", "transcripts"]);
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
