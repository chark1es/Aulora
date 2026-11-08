import { useConvex, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../packages/convex/convex/_generated/api";

type MemberPage = FunctionReturnType<typeof api.members.page>;
export type PagedMember = MemberPage["page"][number];

interface MoreState {
  readonly rows: readonly PagedMember[];
  /** The cursor after the rows loaded so far, or `undefined` before any load. */
  readonly cursor: string | undefined;
  readonly done: boolean;
}

const NOTHING_MORE: MoreState = { rows: [], cursor: undefined, done: false };

export interface MemberPages {
  readonly rows: readonly PagedMember[];
  readonly hasMore: boolean;
  readonly loading: boolean;
  /** Loads the next page after the rows already shown. */
  readonly loadMore: () => void;
}

/**
 * The member directory as bounded pages. The first page is a live query; later
 * pages follow its `continueCursor` and are one-off reads, so the list is
 * complete for any workspace size while every read stays at `pageSize` rows.
 * Nothing is read while `enabled` is false.
 *
 * `autoLoadAll` keeps loading until the directory is exhausted, for pickers and
 * admin lists that must offer everyone; the member panel loads on demand.
 */
export function useMemberPages(
  enabled: boolean,
  pageSize: number,
  autoLoadAll = false,
): MemberPages {
  const convex = useConvex();
  const first = useQuery(api.members.page, enabled ? { numItems: pageSize } : "skip");
  const [more, setMore] = useState<MoreState>(NOTHING_MORE);
  const [loading, setLoading] = useState(false);
  const moreRef = useRef(more);
  moreRef.current = more;
  const loadingRef = useRef(false);
  // After a failed read the automatic loading stops, so a down backend is not
  // asked in a loop; a manual `loadMore` still tries again.
  const failedRef = useRef(false);
  // Bumped when the list is closed, so a page still in flight cannot reappear.
  const epoch = useRef(0);

  const done = first === undefined ? false : more.cursor === undefined ? first.isDone : more.done;

  useEffect(() => {
    if (!enabled) {
      epoch.current += 1;
      loadingRef.current = false;
      failedRef.current = false;
      setLoading(false);
      setMore(NOTHING_MORE);
    }
  }, [enabled]);

  const loadMore = useCallback(() => {
    if (!enabled || first === undefined || loadingRef.current) {
      return;
    }
    const current = moreRef.current;
    const isDone = current.cursor === undefined ? first.isDone : current.done;
    if (isDone) {
      return;
    }
    const cursor = current.cursor ?? first.continueCursor;
    const started = epoch.current;
    loadingRef.current = true;
    setLoading(true);
    void convex
      .query(api.members.page, { cursor, numItems: pageSize })
      .then((result) => {
        if (started !== epoch.current) {
          return;
        }
        failedRef.current = false;
        setMore({
          rows: [...moreRef.current.rows, ...result.page],
          cursor: result.continueCursor,
          done: result.isDone,
        });
      })
      .catch(() => {
        if (started === epoch.current) {
          failedRef.current = true;
        }
      })
      .finally(() => {
        if (started === epoch.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      });
  }, [convex, enabled, first, pageSize]);

  useEffect(() => {
    if (autoLoadAll && enabled && first !== undefined && !done && !loading && !failedRef.current) {
      loadMore();
    }
  }, [autoLoadAll, enabled, first, done, loading, loadMore]);

  const rows = useMemo(() => {
    const byId = new Map<string, PagedMember>();
    for (const member of [...(first?.page ?? []), ...more.rows]) {
      byId.set(member.userId, member);
    }
    return [...byId.values()];
  }, [first, more.rows]);

  return { rows, hasMore: enabled && first !== undefined && !done, loading, loadMore };
}
