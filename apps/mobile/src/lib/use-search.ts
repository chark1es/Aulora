/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { SearchHit } from "@aulora/core";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

const RECENT_LIMIT = 6;

export interface RecentSearches {
  readonly recent: readonly string[];
  /** Puts a query at the front of the list; ignores anything under two characters. */
  readonly remember: (query: string) => void;
  readonly clear: () => void;
}

/** The last few queries someone ran, kept under a key scoped to their server and account. */
export function useRecentSearches(storageKey: string): RecentSearches {
  const [recent, setRecent] = useState<readonly string[]>([]);

  useEffect(() => {
    void AsyncStorage.getItem(storageKey)
      .then((stored) => {
        const parsed: unknown = stored === null ? [] : JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setRecent(parsed.filter((entry): entry is string => typeof entry === "string"));
        }
      })
      .catch(() => undefined);
  }, [storageKey]);

  const remember = useCallback(
    (query: string) => {
      if (query.length < 2) return;
      setRecent((current) => {
        const next = [query, ...current.filter((entry) => entry !== query)].slice(0, RECENT_LIMIT);
        void AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => undefined);
        return next;
      });
    },
    [storageKey],
  );

  const clear = useCallback(() => {
    setRecent([]);
    void AsyncStorage.removeItem(storageKey).catch(() => undefined);
  }, [storageKey]);

  return { recent, remember, clear };
}

export interface MessageSearch {
  readonly hits: readonly SearchHit[];
  /** The first pass over history already on this device is still running. */
  readonly busy: boolean;
  readonly error: string | null;
  /** Progress of reading older history from the server into the index. */
  readonly archive: "loading" | "complete" | "failed";
  /** Restarts the read of older history after it failed. */
  readonly retry: () => void;
}

/**
 * Searches messages for `query`. Results from history already on the device
 * arrive first; older pages are then indexed and the results refined.
 */
export function useMessageSearch(
  query: string,
  search: (query: string) => Promise<readonly SearchHit[]>,
  loadHistory: () => Promise<boolean>,
): MessageSearch {
  const [hits, setHits] = useState<readonly SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archive, setArchive] = useState<MessageSearch["archive"]>("loading");
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` restarts the history read after a failure
  useEffect(() => {
    let cancelled = false;
    // Read through a call so each check sees the value after the await before it.
    const stopped = () => cancelled;
    setHits([]);
    setError(null);
    setArchive("loading");
    setBusy(query.length > 0);
    if (query.length === 0) return;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const results = await search(query);
          if (stopped()) return;
          setHits(results);
        } catch {
          if (!stopped()) setError("Couldn't search messages. Try again.");
          return;
        } finally {
          if (!stopped()) setBusy(false);
        }
        // Results from loaded history show at once; older pages refine them.
        try {
          for (;;) {
            const complete = await loadHistory();
            if (stopped()) return;
            setHits(await search(query));
            if (stopped()) return;
            if (complete) break;
          }
          setArchive("complete");
        } catch {
          if (!stopped()) setArchive("failed");
        }
      })();
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, search, loadHistory, attempt]);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  return { hits, busy, error, archive, retry };
}
