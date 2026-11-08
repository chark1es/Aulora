import { useConvex, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../packages/convex/convex/_generated/api";

type MemberPage = FunctionReturnType<typeof api.members.page>;
export type PagedMember = MemberPage["page"][number];

/** One page after the first, kept live by its own subscription. */
interface LoadedPage {
  readonly rows: readonly PagedMember[];
  /** Where the next page starts. Fixed once a later page is anchored to it. */
  readonly continueCursor: string;
  readonly isDone: boolean;
}

export interface MemberPages {
  readonly rows: readonly PagedMember[];
  readonly hasMore: boolean;
  readonly loading: boolean;
  /** Loads the next page after the rows already shown. */
  readonly loadMore: () => void;
}

/**
 * The member directory as bounded pages. Every page, not just the first, is a
 * live subscription, so a role change or a removal anywhere in the list shows
 * up, while each read stays at `pageSize` rows and the list is complete for any
 * workspace size. Nothing is read while `enabled` is false.
 *
 * A later page is pinned to the cursor it started from. A removal earlier in the
 * list can make a page pull in the next page's first row; rows are keyed by
 * member, so the overlap collapses. New members join at the end and only extend
 * the last page.
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
  const [pages, setPages] = useState<readonly LoadedPage[]>([]);
  const [loading, setLoading] = useState(false);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const subscriptions = useRef<(() => void)[]>([]);
  const loadingRef = useRef(false);
  // After a failed read the automatic loading stops, so a down backend is not
  // asked in a loop; a manual `loadMore` still tries again.
  const failedRef = useRef(false);
  // Bumped when the list is closed, so a page still in flight cannot reappear.
  const epoch = useRef(0);

  const tail = pages.at(-1);
  const done = first === undefined ? false : tail === undefined ? first.isDone : tail.isDone;

  const release = useCallback(() => {
    for (const off of subscriptions.current) {
      off();
    }
    subscriptions.current = [];
  }, []);

  useEffect(() => {
    if (!enabled) {
      epoch.current += 1;
      loadingRef.current = false;
      failedRef.current = false;
      release();
      setLoading(false);
      setPages([]);
    }
  }, [enabled, release]);

  // Drop every subscription when the owner goes away.
  useEffect(() => release, [release]);

  const loadMore = useCallback(() => {
    if (!enabled || first === undefined || loadingRef.current) {
      return;
    }
    const current = pagesRef.current.at(-1);
    if (current === undefined ? first.isDone : current.isDone) {
      return;
    }
    const cursor = current?.continueCursor ?? first.continueCursor;
    const index = pagesRef.current.length;
    const started = epoch.current;
    loadingRef.current = true;
    setLoading(true);

    const watch = convex.watchQuery(api.members.page, { cursor, numItems: pageSize });
    let settled = false;
    let off: (() => void) | undefined;
    const fail = () => {
      failedRef.current = true;
      loadingRef.current = false;
      setLoading(false);
      off?.();
    };
    const apply = () => {
      if (started !== epoch.current) {
        return;
      }
      let result: MemberPage | undefined;
      try {
        result = watch.localQueryResult();
      } catch {
        if (!settled) {
          fail();
        }
        return;
      }
      if (result === undefined) {
        return;
      }
      const latest = result;
      setPages((previous) => {
        const next = [...previous];
        const existing = next[index];
        // Only the last page may move its end: a later page is anchored to it.
        const anchored = existing !== undefined && index < next.length - 1;
        next[index] = {
          rows: latest.page,
          continueCursor: anchored ? existing.continueCursor : latest.continueCursor,
          isDone: anchored ? existing.isDone : latest.isDone,
        };
        return next;
      });
      if (!settled) {
        settled = true;
        failedRef.current = false;
        loadingRef.current = false;
        setLoading(false);
      }
    };
    off = watch.onUpdate(apply);
    subscriptions.current.push(off);
    // The result may already be cached, and then no update would announce it.
    apply();
  }, [convex, enabled, first, pageSize]);

  useEffect(() => {
    if (autoLoadAll && enabled && first !== undefined && !done && !loading && !failedRef.current) {
      loadMore();
    }
  }, [autoLoadAll, enabled, first, done, loading, loadMore]);

  const rows = useMemo(() => {
    const byId = new Map<string, PagedMember>();
    for (const member of [...(first?.page ?? []), ...pages.flatMap((page) => page.rows)]) {
      byId.set(member.userId, member);
    }
    return [...byId.values()];
  }, [first, pages]);

  return { rows, hasMore: enabled && first !== undefined && !done, loading, loadMore };
}
