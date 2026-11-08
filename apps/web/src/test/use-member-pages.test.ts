import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMemberPages } from "../lib/use-member-pages";

const mock = vi.hoisted(() => ({
  first: undefined as unknown,
  /** What each later page's subscription currently holds, by starting cursor. */
  results: new Map<string, unknown>(),
  listeners: new Map<string, () => void>(),
  watched: [] as string[],
  unsubscribed: [] as string[],
  firstArgs: [] as unknown[],
}));

vi.mock("convex/react", () => ({
  useConvex: () => ({
    watchQuery: (_ref: unknown, args: { cursor: string }) => {
      mock.watched.push(args.cursor);
      return {
        onUpdate: (callback: () => void) => {
          mock.listeners.set(args.cursor, callback);
          return () => {
            mock.unsubscribed.push(args.cursor);
          };
        },
        localQueryResult: () => {
          const value = mock.results.get(args.cursor);
          if (value instanceof Error) {
            throw value;
          }
          return value;
        },
      };
    },
  }),
  useQuery: (_ref: unknown, args: unknown) => {
    mock.firstArgs.push(args);
    return args === "skip" ? undefined : mock.first;
  },
}));

const member = (userId: string, role = "member") => ({ userId, role });

function page(ids: string[], isDone: boolean, continueCursor: string, role = "member") {
  return { page: ids.map((id) => member(id, role)), isDone, continueCursor };
}

const ids = (rows: readonly { userId: string }[]) => rows.map((row) => row.userId);

describe("useMemberPages", () => {
  beforeEach(() => {
    mock.results.clear();
    mock.listeners.clear();
    mock.watched.length = 0;
    mock.unsubscribed.length = 0;
    mock.firstArgs.length = 0;
    mock.first = page(["a", "b"], false, "c1");
  });

  it("reads nothing while closed", () => {
    const { result } = renderHook(() => useMemberPages(false, 2, true));
    expect(mock.firstArgs.every((args) => args === "skip")).toBe(true);
    expect(mock.watched).toEqual([]);
    expect(result.current.rows).toEqual([]);
    expect(result.current.hasMore).toBe(false);
  });

  it("follows the cursor until the directory is exhausted when asked to load everyone", async () => {
    mock.results.set("c1", page(["c", "d"], false, "c2"));
    mock.results.set("c2", page(["e"], true, "c3"));
    const { result } = renderHook(() => useMemberPages(true, 2, true));

    await waitFor(() => {
      expect(result.current.hasMore).toBe(false);
    });
    expect(ids(result.current.rows)).toEqual(["a", "b", "c", "d", "e"]);
    expect(mock.watched).toEqual(["c1", "c2"]);
  });

  it("loads one more page at a time on demand, past any fixed cap", async () => {
    mock.results.set("c1", page(["c", "d"], false, "c2"));
    const { result } = renderHook(() => useMemberPages(true, 2));
    expect(result.current.hasMore).toBe(true);
    expect(mock.watched).toEqual([]);

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => {
      expect(result.current.rows).toHaveLength(4);
    });
    // More remain: the panel keeps offering "show more".
    expect(result.current.hasMore).toBe(true);
    expect(mock.watched).toEqual(["c1"]);
  });

  it("does not repeat a member that appears on two pages", async () => {
    mock.results.set("c1", page(["b", "c"], true, "c2"));
    const { result } = renderHook(() => useMemberPages(true, 2, true));
    await waitFor(() => {
      expect(result.current.hasMore).toBe(false);
    });
    expect(ids(result.current.rows)).toEqual(["a", "b", "c"]);
  });

  it("shows a change to a member on a later page as it happens", async () => {
    mock.results.set("c1", page(["c", "d"], true, "c2"));
    const { result } = renderHook(() => useMemberPages(true, 2, true));
    await waitFor(() => {
      expect(result.current.hasMore).toBe(false);
    });
    expect(result.current.rows.find((row) => row.userId === "d")).toMatchObject({
      role: "member",
    });

    // An admin promotes `d`, who lives on the second page.
    mock.results.set("c1", page(["c", "d"], true, "c2", "admin"));
    act(() => {
      mock.listeners.get("c1")?.();
    });

    expect(result.current.rows.find((row) => row.userId === "d")).toMatchObject({
      role: "admin",
    });
    // Still one subscription for that page: it updated in place.
    expect(mock.watched).toEqual(["c1"]);
  });

  it("lets the last page grow when new members join", async () => {
    mock.results.set("c1", page(["c"], true, "c2"));
    const { result } = renderHook(() => useMemberPages(true, 2, true));
    await waitFor(() => {
      expect(result.current.hasMore).toBe(false);
    });

    // Someone joins; the directory continues past the old end.
    mock.results.set("c3", page(["e"], true, "c4"));
    mock.results.set("c1", page(["c", "d"], false, "c3"));
    act(() => {
      mock.listeners.get("c1")?.();
    });
    // It is no longer exhausted, so the next page is loaded.
    await waitFor(() => {
      expect(ids(result.current.rows)).toEqual(["a", "b", "c", "d", "e"]);
    });
  });

  it("stops loading automatically after a failed read instead of retrying in a loop", async () => {
    mock.results.set("c1", new Error("down"));
    const { result } = renderHook(() => useMemberPages(true, 2, true));
    await waitFor(() => {
      expect(mock.watched).toEqual(["c1"]);
    });
    await act(async () => {
      for (let turn = 0; turn < 10; turn += 1) {
        await Promise.resolve();
      }
    });
    expect(mock.watched).toEqual(["c1"]);
    // The people already loaded stay available, and a manual retry is allowed.
    expect(ids(result.current.rows)).toEqual(["a", "b"]);
    expect(result.current.hasMore).toBe(true);

    mock.results.set("c1", page(["c"], true, "c2"));
    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => {
      expect(ids(result.current.rows)).toEqual(["a", "b", "c"]);
    });
  });

  it("drops every page subscription when the list closes", async () => {
    mock.results.set("c1", page(["c", "d"], false, "c2"));
    mock.results.set("c2", page(["e"], true, "c3"));
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useMemberPages(open, 2, true),
      { initialProps: { open: true } },
    );
    await waitFor(() => {
      expect(result.current.hasMore).toBe(false);
    });

    rerender({ open: false });
    await waitFor(() => {
      expect(mock.unsubscribed.sort()).toEqual(["c1", "c2"]);
    });
    expect(result.current.rows).toEqual([]);
  });
});
