import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWideShell, WIDE_SHELL_QUERY } from "../lib/use-wide-shell";

const original = window.matchMedia;

afterEach(() => {
  window.matchMedia = original;
});

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: initial,
    media: WIDE_SHELL_QUERY,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
  };
  const matchMedia = vi.fn((_query: string) => media);
  window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
  return {
    matchMedia,
    listeners,
    set(matches: boolean) {
      media.matches = matches;
      for (const listener of listeners) listener();
    },
  };
}

describe("useWideShell", () => {
  it("reads the two-pane breakpoint on mount", () => {
    const media = stubMatchMedia(true);
    const { result } = renderHook(() => useWideShell());
    expect(result.current).toBe(true);
    expect(media.matchMedia).toHaveBeenCalledWith(WIDE_SHELL_QUERY);
    expect(media.listeners.size).toBe(1);
  });

  it("follows a viewport resize and stops listening on unmount", () => {
    const media = stubMatchMedia(false);
    const { result, unmount } = renderHook(() => useWideShell());
    expect(result.current).toBe(false);
    act(() => {
      media.set(true);
    });
    expect(result.current).toBe(true);
    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it("treats a missing matchMedia implementation as a narrow shell", () => {
    // @ts-expect-error -- older or non-browser environments have no matchMedia.
    window.matchMedia = undefined;
    const { result } = renderHook(() => useWideShell());
    expect(result.current).toBe(false);
  });
});
