import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMemberPages } from "../lib/use-member-pages";

const mock = vi.hoisted(() => ({
  first: undefined as unknown,
  query: vi.fn(),
  firstArgs: [] as unknown[],
}));

vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mock.query }),
  useQuery: (_ref: unknown, args: unknown) => {
    mock.firstArgs.push(args);
    return args === "skip" ? undefined : mock.first;
  },
}));

const member = (userId: string) => ({ userId });

function page(ids: string[], isDone: boolean, continueCursor: string) {
  return { page: ids.map(member), isDone, continueCursor };
}

describe("useMemberPages", () => {
  beforeEach(() => {
    mock.query.mockReset();
    mock.firstArgs.length = 0;
    mock.first = page(["a", "b"], false, "c1");
  });

  it("reads nothing while closed", () => {
    const { result } = renderHook(() => useMemberPages(false, 2, true));
    expect(mock.firstArgs.every((args) => args === "skip")).toBe(true);
    expect(mock.query).not.toHaveBeenCalled();
    expect(result.current.rows).toEqual([]);
    expect(result.current.hasMore).toBe(false);
  });

  it("follows the cursor until the directory is exhausted when asked to load everyone", async () => {
    mock.query
      .mockResolvedValueOnce(page(["c", "d"], false, "c2"))
      .mockResolvedValueOnce(page(["e"], true, "c3"));
    const { result } = renderHook(() => useMemberPages(true, 2, true));

    await waitFor(() => {
      expect(result.current.hasMore).toBe(false);
    });
    expect(result.current.rows.map((row) => row.userId)).toEqual(["a", "b", "c", "d", "e"]);
    expect(mock.query).toHaveBeenNthCalledWith(1, expect.anything(), { cursor: "c1", numItems: 2 });
    expect(mock.query).toHaveBeenNthCalledWith(2, expect.anything(), { cursor: "c2", numItems: 2 });
  });

  it("loads one more page at a time on demand, past any fixed cap", async () => {
    mock.query.mockResolvedValueOnce(page(["c", "d"], false, "c2"));
    const { result } = renderHook(() => useMemberPages(true, 2));
    expect(result.current.hasMore).toBe(true);
    expect(mock.query).not.toHaveBeenCalled();

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => {
      expect(result.current.rows).toHaveLength(4);
    });
    // More remain: the panel keeps offering "show more".
    expect(result.current.hasMore).toBe(true);
    expect(mock.query).toHaveBeenCalledTimes(1);
  });

  it("does not repeat a member that appears on two pages", async () => {
    mock.query.mockResolvedValueOnce(page(["b", "c"], true, "c2"));
    const { result } = renderHook(() => useMemberPages(true, 2, true));
    await waitFor(() => {
      expect(result.current.hasMore).toBe(false);
    });
    expect(result.current.rows.map((row) => row.userId)).toEqual(["a", "b", "c"]);
  });

  it("stops loading automatically after a failed read instead of retrying in a loop", async () => {
    mock.query.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useMemberPages(true, 2, true));
    await waitFor(() => {
      expect(mock.query).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      for (let turn = 0; turn < 10; turn += 1) {
        await Promise.resolve();
      }
    });
    expect(mock.query).toHaveBeenCalledTimes(1);
    // The people already loaded stay available, and a manual retry is allowed.
    expect(result.current.rows.map((row) => row.userId)).toEqual(["a", "b"]);
    expect(result.current.hasMore).toBe(true);
  });
});
