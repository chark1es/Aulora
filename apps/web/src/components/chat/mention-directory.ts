/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { MentionTarget } from "@aulora/core";
import { useEffect, useState } from "react";

/** Wait after the last keystroke before asking the directory for matches. */
const MENTION_SEARCH_DEBOUNCE_MS = 150;
/** Distinct typed names one send resolves through the directory. */
const MENTION_RESOLVE_TOKENS = 8;

/** Server-side member search; the composer does not hold the whole roster. */
export type MemberSearch = (query: string) => Promise<readonly MentionTarget[]>;

/**
 * The people already on screen plus directory results, each person once. A
 * member the composer already knows wins over a directory row for the same id.
 */
export function mergeMentionTargets(
  members: readonly MentionTarget[],
  extra: readonly MentionTarget[],
): MentionTarget[] {
  const known = new Map<string, MentionTarget>();
  for (const member of members) {
    known.set(member.userId, member);
  }
  for (const member of extra) {
    if (!known.has(member.userId)) {
      known.set(member.userId, member);
    }
  }
  return [...known.values()];
}

/**
 * Directory matches for the text typed after `@`, debounced so a burst of
 * keystrokes asks once. Empty while there is no query or no search.
 */
export function useSearchedMembers(
  searchMembers: MemberSearch | undefined,
  query: string,
): readonly MentionTarget[] {
  const [searched, setSearched] = useState<readonly MentionTarget[]>([]);
  useEffect(() => {
    if (searchMembers === undefined || query.length === 0) {
      setSearched([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchMembers(query)
        .then((rows) => {
          if (!cancelled) {
            setSearched(rows);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSearched([]);
          }
        });
    }, MENTION_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, searchMembers]);
  return searched;
}

/**
 * The mention targets to resolve `text` against. The composer holds only the
 * people already on screen, so names it does not know are looked up in the
 * directory before sending; otherwise a typed `@name` for someone outside the
 * timeline would silently lose its mention id.
 */
export async function mentionTargetsFor(
  text: string,
  members: readonly MentionTarget[],
  searchMembers: MemberSearch | undefined,
): Promise<readonly MentionTarget[]> {
  if (searchMembers === undefined) {
    return members;
  }
  const knownNames = new Set(members.map((member) => member.displayName.toLowerCase()));
  const unknown: string[] = [];
  for (const match of text.matchAll(/@([A-Za-z0-9_.-]+)/g)) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- capture groups are `string | undefined` under noUncheckedIndexedAccess
    const token = match[1] ?? "";
    if (token.length === 0 || /^(here|everyone)$/i.test(token)) {
      continue;
    }
    if (!knownNames.has(token.toLowerCase()) && !unknown.includes(token)) {
      unknown.push(token);
    }
    if (unknown.length >= MENTION_RESOLVE_TOKENS) {
      break;
    }
  }
  if (unknown.length === 0) {
    return members;
  }
  const found = (
    await Promise.all(unknown.map((query) => searchMembers(query).catch(() => [])))
  ).flat();
  if (found.length === 0) {
    return members;
  }
  return mergeMentionTargets(members, found);
}
