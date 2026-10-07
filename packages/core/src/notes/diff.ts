/**
 * Minimal line diff for the Notes activity history. Pure and dependency-free
 * so both renderers can show "what changed" between two note snapshots.
 *
 * Uses an LCS table for exact diffs on reasonably sized notes and falls back
 * to an anchor-based diff when a change is too large to diff in a table.
 */

export interface DiffLine {
  readonly type: "context" | "add" | "del";
  readonly text: string;
}

export interface DiffStats {
  readonly added: number;
  readonly removed: number;
}

/** Above this many line pairs the exact LCS table is skipped. */
const MAX_LCS_CELLS = 250_000;

export function diffLines(before: string, after: string): DiffLine[] {
  if (before === after) {
    return splitLines(before).map((text) => ({ type: "context", text }));
  }
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length * b.length > MAX_LCS_CELLS) {
    return coarseDiff(a, b);
  }
  return lcsDiff(a, b);
}

export function diffStats(lines: readonly DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.type === "add") added += 1;
    else if (line.type === "del") removed += 1;
  }
  return { added, removed };
}

function splitLines(text: string): string[] {
  return text.length === 0 ? [] : text.split("\n");
}

function lcsDiff(a: readonly string[], b: readonly string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const row = table[i];
      const next = table[i + 1];
      if (row === undefined || next === undefined) continue;
      row[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ type: "context", text: a[i] ?? "" });
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      result.push({ type: "del", text: a[i] ?? "" });
      i += 1;
    } else {
      result.push({ type: "add", text: b[j] ?? "" });
      j += 1;
    }
  }
  while (i < n) {
    result.push({ type: "del", text: a[i] ?? "" });
    i += 1;
  }
  while (j < m) {
    result.push({ type: "add", text: b[j] ?? "" });
    j += 1;
  }
  return result;
}

/**
 * Coarse diff for very large notes: trims the common prefix and suffix and
 * reports the middle as removed-then-added, which stays correct even when it
 * is not minimal.
 */
function coarseDiff(a: readonly string[], b: readonly string[]): DiffLine[] {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const result: DiffLine[] = [];
  for (let i = 0; i < prefix; i += 1) result.push({ type: "context", text: a[i] ?? "" });
  for (let i = prefix; i < a.length - suffix; i += 1)
    result.push({ type: "del", text: a[i] ?? "" });
  for (let i = prefix; i < b.length - suffix; i += 1)
    result.push({ type: "add", text: b[i] ?? "" });
  for (let i = a.length - suffix; i < a.length; i += 1)
    result.push({ type: "context", text: a[i] ?? "" });
  return result;
}
