import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HIDDEN_VIEW_TTL_MS, MAX_RETAINED_VIEWS, useVisitedViews } from "../lib/use-visited-views";

afterEach(() => {
  vi.useRealTimers();
});

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

  it("releases a hidden surface after the hidden lifetime expires", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ view }: { view: string }) => useVisitedViews(view), {
      initialProps: { view: "notes" },
    });
    rerender({ view: "chat" });
    expect([...result.current].sort()).toEqual(["chat", "notes"]);

    // Still retained while the reader may switch back quickly.
    act(() => {
      vi.advanceTimersByTime(HIDDEN_VIEW_TTL_MS - 1);
    });
    expect(result.current.has("notes")).toBe(true);

    // At the lifetime the hidden view unmounts and its subscriptions release.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect([...result.current]).toEqual(["chat"]);
  });

  it("holds a hidden surface while an unsaved draft must survive", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ view, hold }: { view: string; hold: boolean }) => useVisitedViews(view, { hold }),
      { initialProps: { view: "notes", hold: true } },
    );
    rerender({ view: "chat", hold: true });
    act(() => {
      vi.advanceTimersByTime(HIDDEN_VIEW_TTL_MS * 2);
    });
    expect(result.current.has("notes")).toBe(true);

    rerender({ view: "chat", hold: false });
    act(() => {
      vi.advanceTimersByTime(HIDDEN_VIEW_TTL_MS);
    });
    expect([...result.current]).toEqual(["chat"]);
  });
});
