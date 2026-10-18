/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
/**
 * Collapsed history summaries and grouping, shared by the web and mobile
 * Notes addons. Pure and dependency-free: a revision row can be rendered from
 * a short headline without ever building the full line diff.
 */

import type { DiffStats } from "./diff.js";
import { lineDelta } from "./diff.js";
import type { NoteRevisionAction, NoteSnapshot } from "./types.js";

/** The part of a revision the summary needs, structurally satisfied by both clients. */
export interface HistoryRevision {
  readonly id: string;
  readonly actorId: string;
  readonly action: NoteRevisionAction;
  readonly before: NoteSnapshot | null;
  readonly after: NoteSnapshot | null;
  readonly at: number;
}

/** Reasons that need no before/after comparison: the action says it all. */
const ACTION_HEADLINES: Partial<Record<NoteRevisionAction, string>> = {
  created: "created this note",
  deleted: "deleted this note",
  archived: "archived this note",
  restored: "restored this note",
};

/** How many change parts a collapsed headline keeps before "+N more". */
export const SUMMARY_MAX_PARTS = 2;

/** Consecutive edits by one actor within this window collapse into one row. */
export const EDIT_GROUP_WINDOW_MS = 10 * 60 * 1000;

const TITLE_QUOTE_MAX = 40;

/** Display names for folder and tag lookups; unresolvable values fall back. */
export interface RevisionSummaryOptions {
  /** A folder's name for the snapshot's `folderId`; `null` means unfiled. */
  readonly folderName?: ((folderId: string | null) => string | undefined) | undefined;
  /** A tag's name for the snapshot's tag id. */
  readonly tagName?: ((tagId: string) => string | undefined) | undefined;
}

export interface RevisionSummary {
  /** One compact line, e.g. `edited this note · +12 −3 lines`. */
  readonly headline: string;
  /** Every separate change, in reading order, for the expanded detail list. */
  readonly details: readonly RevisionChange[];
}

/** One change a revision made, tagged so a client can render it specially. */
export interface RevisionChange {
  readonly kind: "title" | "body" | "folder" | "tag";
  readonly text: string;
}

/** "+12 −3", "−3", "+12", or "No changes". */
export function formatLineStats(stats: DiffStats) {
  const parts: string[] = [];
  if (stats.added > 0) parts.push(`+${stats.added}`);
  if (stats.removed > 0) parts.push(`−${stats.removed}`);
  return parts.length === 0 ? "No changes" : parts.join(" ");
}

/** "1 edit" or "5 edits". */
export function formatEditCount(count: number) {
  return `${count} ${count === 1 ? "edit" : "edits"}`;
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function quoteTitle(title: string) {
  const trimmed = title.trim();
  return trimmed.length === 0 ? "(untitled)" : truncate(trimmed, TITLE_QUOTE_MAX);
}

function tagLabel(tagId: string, options: RevisionSummaryOptions) {
  return options.tagName?.(tagId);
}

function folderLabel(folderId: string | null, options: RevisionSummaryOptions) {
  if (folderId === null) return "Unfiled";
  return options.folderName?.(folderId) ?? "another folder";
}

function folderFragment(
  before: NoteSnapshot,
  after: NoteSnapshot,
  options: RevisionSummaryOptions,
): Array<RevisionChange> {
  if (before.folderId === after.folderId) return [];
  return [{ kind: "folder", text: `moved to ${folderLabel(after.folderId, options)}` }];
}

function tagFragments(
  before: NoteSnapshot,
  after: NoteSnapshot,
  options: RevisionSummaryOptions,
): Array<RevisionChange> {
  const parts: RevisionChange[] = [];
  for (const tagId of after.tagIds) {
    if (before.tagIds.includes(tagId)) continue;
    const name = tagLabel(tagId, options);
    parts.push({ kind: "tag", text: name === undefined ? "added a tag" : `added tag ${name}` });
  }
  for (const tagId of before.tagIds) {
    if (after.tagIds.includes(tagId)) continue;
    const name = tagLabel(tagId, options);
    parts.push({ kind: "tag", text: name === undefined ? "removed a tag" : `removed tag ${name}` });
  }
  return parts;
}

function bodyFragment(before: NoteSnapshot, after: NoteSnapshot): Array<RevisionChange> {
  if (before.body === after.body) return [];
  const stats = lineDelta(before.body, after.body);
  const text =
    stats.added === 0 && stats.removed === 0
      ? "changed the text"
      : `${formatLineStats(stats)} lines`;
  return [{ kind: "body", text }];
}

/** The individual changes between two snapshots, in reading order. */
function changeFragments(
  before: NoteSnapshot,
  after: NoteSnapshot,
  options: RevisionSummaryOptions,
): Array<RevisionChange> {
  const parts: RevisionChange[] = [];
  if (before.title !== after.title) {
    parts.push({
      kind: "title",
      text: `renamed: "${quoteTitle(before.title)}" → "${quoteTitle(after.title)}"`,
    });
  }
  parts.push(...bodyFragment(before, after));
  parts.push(...folderFragment(before, after, options));
  parts.push(...tagFragments(before, after, options));
  return parts;
}

function capParts(parts: readonly RevisionChange[]) {
  const shown = parts.slice(0, SUMMARY_MAX_PARTS);
  const extra = parts.length - shown.length;
  const summary = shown.map((part) => part.text).join(", ");
  return extra > 0 ? `${summary} · +${extra} more` : summary;
}

/** A compact, one-line summary of what a revision changed. */
export function summarizeRevision(
  revision: HistoryRevision,
  options: RevisionSummaryOptions = {},
): RevisionSummary {
  const fixed = ACTION_HEADLINES[revision.action];
  if (fixed !== undefined) return { headline: fixed, details: [] };
  if (revision.before === null || revision.after === null) {
    return { headline: "changed the note", details: [] };
  }
  const changes = changeFragments(revision.before, revision.after, options);
  if (changes.length === 0) return { headline: "changed the note", details: [] };
  const summary = capParts(changes);
  const headline = revision.action === "updated" ? `edited this note · ${summary}` : summary;
  return { headline, details: changes };
}

/** One row in the history list: a lone revision or a run of edits. */
export interface HistoryGroup<T extends HistoryRevision = HistoryRevision> {
  readonly id: string;
  readonly kind: "single" | "edits";
  readonly actorId: string;
  /** Newest first. */
  readonly revisions: readonly T[];
  /** Oldest `at` in the group. */
  readonly from: number;
  /** Newest `at` in the group. */
  readonly to: number;
  readonly stats: DiffStats;
}

function revisionStats(revision: HistoryRevision): DiffStats {
  return lineDelta(revision.before?.body ?? "", revision.after?.body ?? "");
}

function sumStats(revisions: readonly HistoryRevision[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const revision of revisions) {
    const stats = revisionStats(revision);
    added += stats.added;
    removed += stats.removed;
  }
  return { added, removed };
}

/** The consecutive edits from `start` that share an actor and fall inside the window. */
function collectEditRun<T extends HistoryRevision>(
  revisions: readonly T[],
  start: number,
  windowMs: number,
): T[] {
  const first = revisions.at(start);
  if (first === undefined || first.action !== "updated") return [];
  const run: T[] = [first];
  for (let cursor = start + 1; cursor < revisions.length; cursor += 1) {
    const next = revisions.at(cursor);
    const previous = run.at(-1);
    if (next === undefined || previous === undefined) break;
    if (next.action !== "updated" || next.actorId !== first.actorId) break;
    if (previous.at - next.at > windowMs) break;
    run.push(next);
  }
  return run;
}

function buildEditGroup<T extends HistoryRevision>(
  lines: readonly T[],
): HistoryGroup<T> | undefined {
  const first = lines[0];
  const last = lines.at(-1);
  if (first === undefined || last === undefined || lines.length < 2) return undefined;
  return {
    id: `edits:${first.id}`,
    kind: "edits",
    actorId: first.actorId,
    revisions: lines,
    from: last.at,
    to: first.at,
    stats: sumStats(lines),
  };
}

function buildSingle<T extends HistoryRevision>(revision: T): HistoryGroup<T> {
  return {
    id: revision.id,
    kind: "single",
    actorId: revision.actorId,
    revisions: [revision],
    from: revision.at,
    to: revision.at,
    stats: revisionStats(revision),
  };
}

/**
 * Groups a newest-first revision list: consecutive `updated` revisions by the
 * same actor within `windowMs` collapse into one row; everything else stays a
 * lone revision. Order is preserved.
 */
export function groupHistory<T extends HistoryRevision>(
  revisions: readonly T[],
  windowMs = EDIT_GROUP_WINDOW_MS,
): HistoryGroup<T>[] {
  const groups: HistoryGroup<T>[] = [];
  let index = 0;
  while (index < revisions.length) {
    const revision = revisions.at(index);
    if (revision === undefined) break;
    const run = collectEditRun(revisions, index, windowMs);
    const group = run.length >= 2 ? buildEditGroup(run) : undefined;
    if (group !== undefined) {
      groups.push(group);
      index += run.length;
      continue;
    }
    groups.push(buildSingle(revision));
    index += 1;
  }
  return groups;
}
