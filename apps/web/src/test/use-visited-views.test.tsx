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

  it("expires a hidden heavy pane while the active Notes editor is dirty", () => {
    vi.useFakeTimers();
    type View = "kanban" | "notes";
    const { result, rerender } = renderHook(
      ({ view, holdView }: { view: View; holdView: View | undefined }) =>
        useVisitedViews(view, { holdView }),
      { initialProps: { view: "notes" as View, holdView: "notes" as View | undefined } },
    );
    rerender({ view: "kanban", holdView: "notes" });
    rerender({ view: "notes", holdView: "notes" });
    expect([...result.current].sort()).toEqual(["kanban", "notes"]);

    // The active draft needs no exemption; it is retained because it is active.
    // The hidden Boards pane must not inherit its protection.
    act(() => {
      vi.advanceTimersByTime(HIDDEN_VIEW_TTL_MS);
    });
    expect([...result.current]).toEqual(["notes"]);
  });

  it("holds only a hidden Notes draft, not a second hidden pane", () => {
    vi.useFakeTimers();
    type View = "chat" | "kanban" | "notes";
    const { result, rerender } = renderHook(
      ({ view, holdView }: { view: View; holdView: View | undefined }) =>
        useVisitedViews(view, { limit: 3, holdView }),
      { initialProps: { view: "notes" as View, holdView: "notes" as View | undefined } },
    );
    rerender({ view: "kanban", holdView: "notes" });
    rerender({ view: "chat", holdView: "notes" });
    expect([...result.current].sort()).toEqual(["chat", "kanban", "notes"]);

    // The hidden draft survives, but the unrelated hidden Boards pane expires
    // and releases its query after the lifetime.
    act(() => {
      vi.advanceTimersByTime(HIDDEN_VIEW_TTL_MS);
    });
    expect([...result.current].sort()).toEqual(["chat", "notes"]);

    // Discarding the draft releases the Notes exception too.
    rerender({ view: "chat", holdView: undefined });
    act(() => {
      vi.advanceTimersByTime(HIDDEN_VIEW_TTL_MS);
    });
    expect([...result.current]).toEqual(["chat"]);
  });
});
