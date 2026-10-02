/** One run of a search snippet, flagged when it matches a query word. */
export interface HighlightPart {
  readonly text: string;
  readonly match: boolean;
}

/**
 * Splits `text` around case-insensitive occurrences of any query word of two
 * or more characters. A plain scan, so a query never becomes a pattern.
 */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 1);
  const lower = text.toLowerCase();
  // A few characters change length when lowercased; offsets would then drift.
  if (words.length === 0 || lower.length !== text.length) {
    return text.length > 0 ? [{ text, match: false }] : [];
  }
  const parts: HighlightPart[] = [];
  let plainFrom = 0;
  let cursor = 0;
  while (cursor < text.length) {
    let hit = 0;
    for (const word of words) {
      if (word.length > hit && lower.startsWith(word, cursor)) hit = word.length;
    }
    if (hit === 0) {
      cursor += 1;
      continue;
    }
    if (plainFrom < cursor) parts.push({ text: text.slice(plainFrom, cursor), match: false });
    parts.push({ text: text.slice(cursor, cursor + hit), match: true });
    cursor += hit;
    plainFrom = cursor;
  }
  if (plainFrom < text.length) parts.push({ text: text.slice(plainFrom), match: false });
  return parts;
}

/**
 * Storage key for recent searches. Queries can be sensitive, so they are kept
 * per server and per account, like the offline outbox.
 */
export function recentSearchKey(serverUrl: string, userId: string): string {
  return `aulora.search.recent:${serverUrl}:${userId}`;
}
