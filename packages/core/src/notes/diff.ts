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

/**
 * Tighter cap for the collapsed summaries, which run for every row. Small
 * enough to stay cheap on a long history, large enough that ordinary notes
 * still get an exact count.
 */
const MAX_SUMMARY_LCS_CELLS = 40_000;

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

/**
 * Cheap line delta for the collapsed history summaries. For notes small
 * enough to diff exactly (the common case) this matches the aligned diff the
 * user sees when a row expands; only genuinely large notes fall back to a
 * linear prefix/suffix count, which can overcount a middle edit.
 */
export function lineDelta(before: string, after: string): DiffStats {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length * b.length <= MAX_SUMMARY_LCS_CELLS) return diffStats(lcsDiff(a, b));
  const { prefix, suffix } = commonBounds(a, b);
  return { added: b.length - prefix - suffix, removed: a.length - prefix - suffix };
}

function splitLines(text: string): string[] {
  return text.length === 0 ? [] : text.split("\n");
}

/** The shared start and end of two line lists, for coarse, linear edits. */
function commonBounds(
  a: readonly string[],
  b: readonly string[],
): { readonly prefix: number; readonly suffix: number } {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a.at(prefix) === b.at(prefix)) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a.at(-1 - suffix) === b.at(-1 - suffix)
  ) {
    suffix += 1;
  }
  return { prefix, suffix };
}

function buildLcsTable(a: readonly string[], b: readonly string[]) {
  const columns = b.length + 1;
  const table = new DataView(new ArrayBuffer((a.length + 1) * columns * 4));
  const get = (row: number, column: number): number =>
    table.getUint32((row * columns + column) * 4);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const length =
        a.at(i) === b.at(j) ? get(i + 1, j + 1) + 1 : Math.max(get(i + 1, j), get(i, j + 1));
      table.setUint32((i * columns + j) * 4, length);
    }
  }
  return get;
}

function lcsDiff(a: readonly string[], b: readonly string[]): DiffLine[] {
  const getLength = buildLcsTable(a, b);
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a.at(i) === b.at(j)) {
      result.push({ type: "context", text: a.at(i) ?? "" });
      i += 1;
      j += 1;
    } else if (getLength(i + 1, j) >= getLength(i, j + 1)) {
      result.push({ type: "del", text: a.at(i) ?? "" });
      i += 1;
    } else {
      result.push({ type: "add", text: b.at(j) ?? "" });
      j += 1;
    }
  }
  for (const text of a.slice(i)) {
    result.push({ type: "del", text });
  }
  for (const text of b.slice(j)) {
    result.push({ type: "add", text });
  }
  return result;
}

/**
 * Coarse diff for very large notes: trims the common prefix and suffix and
 * reports the middle as removed-then-added, which stays correct even when it
 * is not minimal.
 */
function coarseDiff(a: readonly string[], b: readonly string[]): DiffLine[] {
  const { prefix, suffix } = commonBounds(a, b);
  const result: DiffLine[] = [];
  for (const text of a.slice(0, prefix)) result.push({ type: "context", text });
  for (const text of a.slice(prefix, a.length - suffix)) result.push({ type: "del", text });
  for (const text of b.slice(prefix, b.length - suffix)) result.push({ type: "add", text });
  for (const text of a.slice(a.length - suffix)) result.push({ type: "context", text });
  return result;
}
