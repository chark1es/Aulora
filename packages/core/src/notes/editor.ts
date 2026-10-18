/**
 * Pure text transforms for the Markdown note editor, shared by the web and
 * mobile clients so a formatting button behaves identically everywhere.
 *
 * Every transform takes the whole document plus the selection (or caret) and
 * returns the next document with the selection that should follow it. Toggle
 * transforms undo their own formatting when the text is already marked up, so
 * clicking Bold twice on a selection leaves the note as it started.
 */

export interface NoteEdit {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** A point the editor can return to: the document and where the caret was. */
export type NoteEditSnapshot = NoteEdit;

export type NoteWrapKind = "bold" | "italic" | "code";

/** How a change reached the note, used to coalesce undo steps. */
export type NoteChangeKind = "type" | "word" | "action";

interface WrapSpec {
  readonly marker: string;
  readonly placeholder: string;
}

const BOLD: WrapSpec = { marker: "**", placeholder: "bold" };
const ITALIC: WrapSpec = { marker: "*", placeholder: "italic" };
const CODE: WrapSpec = { marker: "`", placeholder: "code" };

function wrapSpec(kind: NoteWrapKind) {
  if (kind === "italic") return ITALIC;
  return kind === "code" ? CODE : BOLD;
}

const LINK = /\[([^\]]*)\]\(([^)]*)\)/g;

const BULLET_PREFIX = /^([ \t]*)[-*+][ \t]+/;
const ORDERED_PREFIX = /^([ \t]*)\d+[.)][ \t]+/;
const CHECKBOX_PREFIX = /^([ \t]*)[-*+][ \t]+\[([ xX])\][ \t]+/;
const HEADING_PREFIX = /^([ \t]*)#{1,6}[ \t]+/;
const LIST_PREFIXES = [CHECKBOX_PREFIX, ORDERED_PREFIX, BULLET_PREFIX];

function clamp(index: number, length: number) {
  return Math.max(0, Math.min(index, length));
}

interface LineSpan {
  readonly from: number;
  readonly to: number;
}

/** The first and last line the selection touches, without their newlines. */
function selectionRange(value: string, start: number, end: number): LineSpan {
  const safeStart = clamp(start, value.length);
  const safeEnd = clamp(end, value.length);
  const from = value.lastIndexOf("\n", Math.max(0, safeStart - 1)) + 1;
  const newline = value.indexOf("\n", safeEnd);
  return { from, to: newline === -1 ? value.length : newline };
}

function lineSpans(value: string, start: number, end: number): LineSpan[] {
  const { from, to } = selectionRange(value, start, end);
  const spans: LineSpan[] = [];
  let index = from;
  for (;;) {
    const newline = value.indexOf("\n", index);
    const lineEnd = newline === -1 || newline > to ? to : newline;
    spans.push({ from: index, to: lineEnd });
    if (newline === -1 || newline >= to) break;
    index = newline + 1;
  }
  return spans;
}

function isBlank(line: string) {
  return line.trim().length === 0;
}

/** Removes every list or heading marker from the front of a line. */
function stripLinePrefix(line: string) {
  let out = line;
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of [...LIST_PREFIXES, HEADING_PREFIX]) {
      const next = out.replace(prefix, "$1");
      if (next !== out) {
        out = next;
        changed = true;
      }
    }
  }
  return out;
}

function hasListPrefix(line: string, ordered: boolean) {
  return (ordered ? ORDERED_PREFIX : BULLET_PREFIX).test(line);
}

/** Whether a line opens with exactly `level` hashes followed by a space or tab. */
function hasHeadingLevel(line: string, level: number) {
  const trimmed = line.trimStart();
  const rest = trimmed.slice(level);
  return trimmed.startsWith("#".repeat(level)) && (rest.startsWith(" ") || rest.startsWith("\t"));
}

/**
 * Wraps or unwraps the selection with a marker pair. An empty selection inserts
 * the placeholder and selects it, so pressing the same button again removes it.
 */
export function toggleWrap(value: string, start: number, end: number, kind: NoteWrapKind) {
  const { marker, placeholder } = wrapSpec(kind);
  const length = marker.length;
  const selected = value.slice(start, end);
  const block = removePlaceholderBlock(value, start, end, marker, placeholder);
  if (block !== null) return block;
  const wrap = findWrap(value, start, end, marker);
  if (wrap !== null) {
    const inner = value.slice(wrap.open + length, wrap.close - length);
    const text = `${value.slice(0, wrap.open)}${inner}${value.slice(wrap.close)}`;
    if (start === end) return { text, start: wrap.open, end: wrap.open };
    if (inner === placeholder) return { text, start: wrap.open, end: wrap.open };
    return { text, start: wrap.open, end: wrap.open + inner.length };
  }
  if (start === end) {
    const removed = removePlaceholder(value, start, marker, placeholder);
    if (removed !== null) return removed;
  }
  if (isSelfWrapped(selected, marker)) {
    const inner = selected.slice(length, selected.length - length);
    return {
      text: `${value.slice(0, start)}${inner}${value.slice(end)}`,
      start,
      end: start + inner.length,
    };
  }
  const inner = selected.length > 0 ? selected : placeholder;
  const text = `${value.slice(0, start)}${marker}${inner}${marker}${value.slice(end)}`;
  const offset = start + length;
  return { text, start: offset, end: offset + inner.length };
}

/** Removes the marker pair *and* its placeholder when the whole block is selected. */
function removePlaceholderBlock(
  value: string,
  start: number,
  end: number,
  marker: string,
  placeholder: string,
) {
  const length = marker.length;
  if (value.slice(start, end) !== placeholder) return null;
  if (value.slice(start - length, start) !== marker) return null;
  if (value.slice(end, end + length) !== marker) return null;
  const text = `${value.slice(0, start - length)}${value.slice(end + length)}`;
  return { text, start: start - length, end: start - length };
}

/** How many `*` run away from `from`, leftwards (step -1, ending before it) or rightwards (step 1). */
function starRun(value: string, from: number, step: number) {
  let count = 0;
  let index = step > 0 ? from : from - 1;
  while (value.charAt(index) === "*") {
    count += 1;
    index += step;
  }
  return count;
}

/** Locates the marker pair around the selection, or enclosing the caret. */
function findWrap(value: string, start: number, end: number, marker: string) {
  if (start === end) return enclosingWrap(value, start, marker);
  const length = marker.length;
  if (start < length || end + length > value.length) return null;
  if (value.slice(start - length, start) !== marker) return null;
  if (value.slice(end, end + length) !== marker) return null;
  // Italic and bold share `*`: a run of one or three is italic (`*a*`, `***a***`),
  // a run of two is bold only, so italic is on exactly when the shared run is odd.
  if (marker === "*") {
    const run = Math.min(starRun(value, start, -1), starRun(value, end, 1));
    if (run % 2 === 0) return null;
    return { open: start - length, close: end + length };
  }
  // A single marker beside another is part of a longer run, not a pair.
  if (
    marker.length === 1 &&
    (value.charAt(start - length - 1) === marker || value.charAt(end + length) === marker)
  ) {
    return null;
  }
  return { open: start - length, close: end + length };
}

/** The markers surrounding `caret` on its line, when the caret sits inside them. */
function enclosingWrap(value: string, caret: number, marker: string) {
  const length = marker.length;
  const open = value.lastIndexOf(marker, caret - length);
  if (open === -1) return null;
  const after = value.indexOf(marker, caret);
  if (after === -1) return null;
  if (value.slice(open, after).includes("\n")) return null;
  if (marker.length === 1) {
    // A `*` that is part of `**` opens nothing.
    if ("*" === value.charAt(open - 1) || "*" === value.charAt(open + 1)) return null;
    if ("*" === value.charAt(after - 1) || "*" === value.charAt(after + 1)) return null;
  }
  return { open, close: after + length };
}

function isSelfWrapped(selected: string, marker: string) {
  if (selected.length <= marker.length * 2) return false;
  if (marker.length === 1 && selected.startsWith(marker.repeat(2))) return false;
  return selected.startsWith(marker) && selected.endsWith(marker);
}

/** Removes the `**placeholder**` an earlier click inserted next to the caret. */
function removePlaceholder(value: string, caret: number, marker: string, placeholder: string) {
  const block = `${marker}${placeholder}${marker}`;
  const left = caret - block.length;
  if (left >= 0 && value.slice(left, caret) === block) {
    return { text: value.slice(0, left) + value.slice(caret), start: left, end: left };
  }
  const right = caret + block.length;
  if (right <= value.length && value.slice(caret, right) === block) {
    return { text: value.slice(0, caret) + value.slice(right), start: caret, end: caret };
  }
  return null;
}

/** Toggles a bullet or ordered list, converting between the two. */
export function toggleList(value: string, start: number, end: number, ordered: boolean): NoteEdit {
  const { from, to } = selectionRange(value, start, end);
  const lines = value.slice(from, to).split("\n");
  const body = lines.filter((line) => !isBlank(line));
  const removing = body.length > 0 && body.every((line) => hasListPrefix(line, ordered));
  let index = 1;
  const next = lines.map((line) => {
    if (removing) return stripLinePrefix(line);
    if (isBlank(line)) return line;
    const marker = ordered ? `${index++}. ` : "- ";
    return `${marker}${stripLinePrefix(line)}`;
  });
  return replaceBlock(value, from, to, next.join("\n"));
}

/** Applies an exact heading level, or removes headings when the level is 0. */
export function applyHeading(value: string, start: number, end: number, level: number): NoteEdit {
  const { from, to } = selectionRange(value, start, end);
  const safeLevel = Math.max(0, Math.min(6, level));
  const lines = value.slice(from, to).split("\n");
  const body = lines.filter((line) => !isBlank(line));
  const removing =
    safeLevel === 0 || (body.length > 0 && body.every((line) => hasHeadingLevel(line, safeLevel)));
  const marker = safeLevel === 0 ? "" : `${"#".repeat(safeLevel)} `;
  const next = lines.map((line) => {
    if (isBlank(line)) return line;
    if (removing) return line.replace(HEADING_PREFIX, "$1");
    return `${marker}${line.replace(HEADING_PREFIX, "$1")}`;
  });
  return replaceBlock(value, from, to, next.join("\n"));
}

/** Cycles the heading on the first line: none, `#`, `##`, `###`, then none. */
export function cycleHeading(value: string, start: number, end: number): NoteEdit {
  const { from } = selectionRange(value, start, end);
  const line = value.slice(from).split("\n").at(0) ?? "";
  const match = HEADING_PREFIX.exec(line);
  const level = match === null ? 0 : [...match[0]].filter((char) => char === "#").length;
  const next = level === 0 ? 1 : level >= 3 ? 0 : level + 1;
  return applyHeading(value, start, end, next);
}

/** Indents (`delta` 1) or outdents (`delta` -1) every touched line by two spaces. */
export function indentLines(value: string, start: number, end: number, delta: 1 | -1): NoteEdit {
  const spans = lineSpans(value, start, end);
  const edits = spans.map((span) => ({
    span,
    ...indentEdit(value.slice(span.from, span.to), delta),
  }));
  const from = spans.at(0)?.from ?? start;
  const to = spans.at(-1)?.to ?? end;
  let block = "";
  let cursor = from;
  for (const edit of edits) {
    block += value.slice(cursor, edit.span.from);
    block += edit.insert;
    block += value.slice(edit.span.from + edit.remove, edit.span.to);
    cursor = edit.span.to;
  }
  block += value.slice(cursor, to);
  return {
    text: `${value.slice(0, from)}${block}${value.slice(to)}`,
    start: mapIndex(start, edits),
    end: mapIndex(end, edits),
  };
}

interface LineDelta {
  readonly insert: string;
  readonly remove: number;
}

interface LineEdit {
  readonly span: LineSpan;
  readonly insert: string;
  readonly remove: number;
}

function indentEdit(line: string, delta: 1 | -1): LineDelta {
  if (delta === 1) return { insert: "  ", remove: 0 };
  const match = /^[ \t]{1,2}/.exec(line);
  return { insert: "", remove: match?.[0].length ?? 0 };
}

function mapIndex(index: number, edits: readonly LineEdit[]): number {
  let shift = 0;
  for (const edit of edits) {
    if (edit.span.from > index) break;
    const net = edit.insert.length - edit.remove;
    if (edit.span.to > index) {
      // The caret sat inside the removed whitespace; snap it to the line start.
      if (index < edit.span.from + edit.remove) return edit.span.from + shift + edit.insert.length;
      return index + shift + net;
    }
    shift += net;
  }
  return index + shift;
}

/**
 * Pressing Enter inside a list item: continues the list with the next marker,
 * or ends it (returns `null` outside a list so the browser inserts the break).
 * An Enter on an empty item clears its marker.
 */
export function continueList(value: string, start: number, end: number) {
  if (start !== end) return null;
  const { from, to } = selectionRange(value, start, end);
  const line = value.slice(from, to);
  const marker = listMarker(line);
  if (marker === null) return null;
  if (marker.content.trim().length === 0) {
    const text = value.slice(0, from) + marker.indent + value.slice(from + marker.length);
    const caret = from + marker.indent.length;
    return { text, start: caret, end: caret };
  }
  const insert = `\n${marker.next}`;
  const caret = start + insert.length;
  return { text: value.slice(0, start) + insert + value.slice(start), start: caret, end: caret };
}

interface ListMarker {
  readonly indent: string;
  /** The full marker including its trailing space. */
  readonly length: number;
  /** What is left on the line after the marker. */
  readonly content: string;
  /** The marker the next item should carry. */
  readonly next: string;
}

function listMarker(line: string): ListMarker | null {
  const checkbox = /^([ \t]*)[-*+][ \t]+\[[ xX]\][ \t]+(.*)$/.exec(line);
  if (checkbox !== null) {
    const [, indent = "", content = ""] = checkbox;
    return { indent, length: line.length - content.length, content, next: `${indent}- [ ] ` };
  }
  const bullet = /^([ \t]*)([-*+])([ \t]+)(.*)$/.exec(line);
  if (bullet !== null) {
    const [, indent = "", symbol = "-", , content = ""] = bullet;
    return { indent, length: line.length - content.length, content, next: `${indent}${symbol} ` };
  }
  const ordered = /^([ \t]*)(\d+)([.)])([ \t]+)(.*)$/.exec(line);
  if (ordered === null) return null;
  const [, indent = "", digits = "1", delimiter = ".", , content = ""] = ordered;
  const next = `${indent}${Number.parseInt(digits, 10) + 1}${delimiter} `;
  return { indent, length: line.length - content.length, content, next };
}

/** Inserts a link around the selection, or unwraps a link the caret sits in. */
export function insertLink(value: string, start: number, end: number): NoteEdit {
  const existing = findLinkAt(value, start, end);
  if (existing !== null) {
    const text = `${value.slice(0, existing.from)}${existing.label}${value.slice(existing.to)}`;
    return { text, start: existing.from, end: existing.from + existing.label.length };
  }
  const selected = value.slice(start, end);
  const label = selected.length > 0 ? selected : "text";
  const text = `${value.slice(0, start)}[${label}](url)${value.slice(end)}`;
  const urlStart = start + label.length + 3;
  return { text, start: urlStart, end: urlStart + 3 };
}

interface FoundLink {
  readonly from: number;
  readonly to: number;
  readonly label: string;
}

function findLinkAt(value: string, start: number, end: number): FoundLink | null {
  for (const match of value.matchAll(LINK)) {
    const [whole, label = ""] = match;
    const from = match.index;
    const to = from + whole.length;
    const inside = start === end ? from < start && start < to : start >= from && end <= to;
    if (inside) return { from, to, label };
  }
  return null;
}

function replaceBlock(value: string, from: number, to: number, block: string): NoteEdit {
  return {
    text: `${value.slice(0, from)}${block}${value.slice(to)}`,
    start: from,
    end: from + block.length,
  };
}

/**
 * Whether an edit that turned `previous` into `next` was ordinary typing, a word
 * boundary (whitespace, paste or a replacement), or a formatting action.
 */
export function typedChangeKind(previous: string, next: string): NoteChangeKind {
  if (next.length === previous.length + 1) {
    const char = next.charAt(firstDifference(previous, next));
    return /\s/.test(char) ? "word" : "type";
  }
  return next.length === previous.length - 1 ? "type" : "word";
}

function firstDifference(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a.charAt(index) === b.charAt(index)) index += 1;
  return index;
}

export interface NoteHistoryOptions {
  /** How many undo steps to keep. Older steps are dropped first. */
  readonly limit?: number;
  /** Typing within this many milliseconds folds into the current step. */
  readonly coalesceMs?: number;
}

/**
 * An explicit undo/redo stack. A controlled textarea loses its native history
 * when React rewrites its value, so the editor owns the snapshots instead.
 */
export class NoteEditHistory {
  private past: NoteEditSnapshot[] = [];
  private future: NoteEditSnapshot[] = [];
  private lastKind: NoteChangeKind | undefined;
  private lastAt = 0;
  private readonly limit: number;
  private readonly coalesceMs: number;

  constructor(options: NoteHistoryOptions = {}) {
    this.limit = options.limit ?? 200;
    this.coalesceMs = options.coalesceMs ?? 500;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  reset(): void {
    this.past = [];
    this.future = [];
    this.lastKind = undefined;
    this.lastAt = 0;
  }

  /** Remembers `previous` before an edit, folding rapid typing into one step. */
  record(previous: NoteEditSnapshot, kind: NoteChangeKind, now: number): void {
    this.future = [];
    if (kind === "type" && this.lastKind === "type" && now - this.lastAt <= this.coalesceMs) {
      this.lastAt = now;
      return;
    }
    this.past.push(previous);
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
    this.lastKind = kind === "word" ? "type" : kind;
    this.lastAt = now;
  }

  undo(current: NoteEditSnapshot): NoteEditSnapshot | undefined {
    const snapshot = this.past.pop();
    if (snapshot === undefined) return undefined;
    this.future.push(current);
    this.lastKind = undefined;
    return snapshot;
  }

  redo(current: NoteEditSnapshot): NoteEditSnapshot | undefined {
    const snapshot = this.future.pop();
    if (snapshot === undefined) return undefined;
    this.past.push(current);
    this.lastKind = undefined;
    return snapshot;
  }
}

const MAC_SYMBOLS = new Map<string, string>([
  ["Mod", "⌘"],
  ["Shift", "⇧"],
  ["Alt", "⌥"],
  ["Ctrl", "⌃"],
]);

const PC_NAMES = new Map<string, string>([
  ["Mod", "Ctrl"],
  ["Shift", "Shift"],
  ["Alt", "Alt"],
  ["Ctrl", "Ctrl"],
]);

/** Renders a key combination as "⌘B" on macOS and "Ctrl+B" elsewhere. */
export function formatShortcut(parts: readonly string[], mac: boolean): string {
  const labels = parts.map((part) => (mac ? MAC_SYMBOLS : PC_NAMES).get(part) ?? part);
  return mac ? labels.join("") : labels.join("+");
}
