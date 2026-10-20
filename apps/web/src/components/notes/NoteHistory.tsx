/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import {
  type DiffLine,
  diffLines,
  diffStats,
  formatEditCount,
  formatLineStats,
  groupHistory,
  type HistoryGroup,
  type RevisionSummary,
  type RevisionSummaryOptions,
  summarizeRevision,
} from "@aulora/core";
import { cn, Icon, Spinner } from "@aulora/ui-web";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { domId, formatGroupTime } from "./note-history-helpers";
import { formatTimestamp, type NoteRevision } from "./types";
import type { NotesController } from "./use-notes";

function DiffRow({ line }: { line: DiffLine }) {
  const marker = line.type === "add" ? "+" : line.type === "del" ? "−" : " ";
  return (
    <div
      className={cn(
        "whitespace-pre-wrap [overflow-wrap:anywhere]",
        line.type === "add" && "bg-secondary/10 text-secondary",
        line.type === "del" && "bg-danger/10 text-danger",
        line.type === "context" && "text-text-muted",
      )}
    >
      <span className="select-none opacity-60">{marker} </span>
      {line.text.length > 0 ? line.text : "\u00A0"}
    </div>
  );
}

/**
 * The full line diff. Only rendered for an expanded row, so the exact LCS
 * diff is never built for collapsed revisions.
 */
function DiffView({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  const stats = useMemo(() => diffStats(lines), [lines]);
  if (lines.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-[8px] border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-2.5 py-1 text-[11px] font-medium">
        <span className="text-secondary">+{stats.added}</span>
        <span className="text-danger">−{stats.removed}</span>
      </div>
      <pre className="max-h-72 overflow-auto bg-surface-3 px-3 py-2 font-mono text-[12px] leading-relaxed">
        {lines.map((line, index) => {
          const lineKey = `${line.type}:${index}`;
          return <DiffRow key={lineKey} line={line} />;
        })}
      </pre>
    </div>
  );
}

function actorName(ctl: NotesController, actorId: string): string {
  return ctl.members.find((member) => member.userId === actorId)?.displayName ?? "Former member";
}

/** Folder and tag name lookups so summaries read "moved to Work", not an id. */
function useSummaryOptions(ctl: NotesController): RevisionSummaryOptions {
  const folders = ctl.folders;
  const tags = ctl.tags;
  return useMemo(() => {
    const byFolder = new Map<string, string>(folders.map((folder) => [folder.id, folder.name]));
    const byTag = new Map<string, string>(tags.map((tag) => [tag.id, tag.name]));
    return {
      folderName: (folderId: string | null) =>
        folderId === null ? "Unfiled" : byFolder.get(folderId),
      tagName: (tagId: string) => byTag.get(tagId),
    };
  }, [folders, tags]);
}

/** The expanded body of one revision: its change list and the line diff. */
function RevisionDetail({
  revision,
  summary,
}: {
  revision: NoteRevision;
  summary: RevisionSummary;
}) {
  const before = revision.before;
  const after = revision.after;
  const metaChanged =
    before !== null &&
    after !== null &&
    (before.title !== after.title ||
      before.folderId !== after.folderId ||
      before.tagIds.join("\u0000") !== after.tagIds.join("\u0000"));
  const bodyBefore = before?.body ?? "";
  const bodyAfter = after?.body ?? "";
  const bodyChanged = bodyBefore !== bodyAfter;
  if (!metaChanged && !bodyChanged) {
    return <p className="text-[12px] text-text-muted">No text changes.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {metaChanged && (
        <ul className="flex flex-col gap-1 text-[12px] text-text-muted">
          {summary.details
            .filter((detail) => detail.kind !== "body")
            .map((detail) => (
              <li key={`${detail.kind}:${detail.text}`}>{detail.text}</li>
            ))}
        </ul>
      )}
      {bodyChanged && <DiffView before={bodyBefore} after={bodyAfter} />}
    </div>
  );
}

/** The clickable row header: a chevron button with the summary and time. */
function RowHeader({
  panelId,
  expanded,
  onToggle,
  children,
}: {
  panelId: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={panelId}
      onClick={onToggle}
      className="flex w-full items-center gap-2 rounded-[6px] px-4 py-2.5 text-left transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
    >
      <Icon
        name={expanded ? "chevron-down" : "chevron-right"}
        size={16}
        className="shrink-0 text-text-muted"
      />
      {children}
    </button>
  );
}

function RevisionRow({
  ctl,
  options,
  revision,
  expanded,
  onToggle,
}: {
  ctl: NotesController;
  options: RevisionSummaryOptions;
  revision: NoteRevision;
  expanded: boolean;
  onToggle: () => void;
}) {
  const panelId = domId("note-revision", revision.id);
  const summary = useMemo(() => summarizeRevision(revision, options), [revision, options]);
  const actor = actorName(ctl, revision.actorId);
  return (
    <li className="border-b border-border last:border-b-0">
      <RowHeader panelId={panelId} expanded={expanded} onToggle={onToggle}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[13px] text-text">
            <span className="font-medium">{actor}</span> {summary.headline}
          </span>
        </span>
        <time
          className="shrink-0 text-[11px] tabular-nums text-text-muted"
          dateTime={new Date(revision.at).toISOString()}
        >
          {formatTimestamp(revision.at)}
        </time>
      </RowHeader>
      {expanded && (
        <div id={panelId} className="px-4 pb-3 pl-10">
          <RevisionDetail revision={revision} summary={summary} />
        </div>
      )}
    </li>
  );
}

interface EditGroupProps {
  ctl: NotesController;
  options: RevisionSummaryOptions;
  group: HistoryGroup<NoteRevision>;
  now: number;
  expanded: boolean;
  onToggle: () => void;
  expandedIds: ReadonlySet<string>;
  onToggleRevision: (id: string) => void;
}

function EditGroupRow(props: EditGroupProps) {
  const { ctl, options, group, now, expanded, onToggle, expandedIds, onToggleRevision } = props;
  const panelId = domId("note-edit-group", group.id);
  const actor = actorName(ctl, group.actorId);
  return (
    <li className="border-b border-border last:border-b-0">
      <RowHeader panelId={panelId} expanded={expanded} onToggle={onToggle}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[13px] text-text">
            <span className="font-medium">
              {formatEditCount(group.revisions.length)} by {actor}
            </span>
          </span>
          <span className="truncate text-[11px] text-text-muted">
            {formatGroupTime(group.from, group.to, now)} · {formatLineStats(group.stats)}
          </span>
        </span>
      </RowHeader>
      {expanded && (
        <ul id={panelId} className="border-t border-border bg-surface-2/40">
          {group.revisions.map((revision) => (
            <RevisionRow
              key={revision.id}
              ctl={ctl}
              options={options}
              revision={revision}
              expanded={expandedIds.has(revision.id)}
              onToggle={() => {
                onToggleRevision(revision.id);
              }}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function toggleInSet(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** The list, one row per group; single revisions render directly. */
function HistoryList({
  ctl,
  options,
  groups,
  expanded,
  now,
  onToggle,
}: {
  ctl: NotesController;
  options: RevisionSummaryOptions;
  groups: readonly HistoryGroup<NoteRevision>[];
  expanded: ReadonlySet<string>;
  now: number;
  onToggle: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col">
      {groups.map((group) => (
        <HistoryGroupRow
          key={group.id}
          ctl={ctl}
          options={options}
          group={group}
          expanded={expanded}
          now={now}
          onToggle={onToggle}
        />
      ))}
    </ul>
  );
}

/** One group's `<li>`: either its own editable row or the single revision. */
function HistoryGroupRow({
  ctl,
  options,
  group,
  expanded,
  now,
  onToggle,
}: {
  ctl: NotesController;
  options: RevisionSummaryOptions;
  group: HistoryGroup<NoteRevision>;
  expanded: ReadonlySet<string>;
  now: number;
  onToggle: (id: string) => void;
}) {
  if (group.kind === "edits") {
    return (
      <EditGroupRow
        ctl={ctl}
        options={options}
        group={group}
        now={now}
        expanded={expanded.has(group.id)}
        onToggle={() => {
          onToggle(group.id);
        }}
        expandedIds={expanded}
        onToggleRevision={onToggle}
      />
    );
  }
  const entry = group.revisions.at(0);
  if (entry === undefined) return null;
  return (
    <RevisionRow
      ctl={ctl}
      options={options}
      revision={entry}
      expanded={expanded.has(entry.id)}
      onToggle={() => {
        onToggle(entry.id);
      }}
    />
  );
}

/** Every recorded change to the open note, newest first, collapsed until opened. */
export function NoteHistory({ ctl }: { ctl: NotesController }) {
  const revisions = ctl.history;
  const options = useSummaryOptions(ctl);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const groups = useMemo(
    () => (revisions === undefined ? [] : groupHistory(revisions)),
    [revisions],
  );
  const allIds = useMemo(
    () => groups.flatMap((group) => [group.id, ...group.revisions.map((entry) => entry.id)]),
    [groups],
  );
  const allExpanded = allIds.length > 0 && allIds.every((id) => expanded.has(id));
  const toggle = useCallback((id: string) => {
    setExpanded((current) => toggleInSet(current, id));
  }, []);
  const toggleAll = useCallback(() => {
    setExpanded(allExpanded ? new Set<string>() : new Set(allIds));
  }, [allExpanded, allIds]);

  if (revisions === undefined) {
    return (
      <div className="flex items-center justify-center p-10">
        <Spinner label="Loading note history" />
      </div>
    );
  }
  if (revisions.length === 0) {
    return <p className="p-8 text-center text-[13px] text-text-muted">No history yet.</p>;
  }
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-1.5">
        <span className="text-[11px] tabular-nums text-text-muted">
          {revisions.length} {revisions.length === 1 ? "revision" : "revisions"}
        </span>
        <button
          type="button"
          onClick={toggleAll}
          className="rounded-[6px] px-2 py-1 text-[12px] font-medium text-text-muted transition hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {allExpanded ? "Collapse all" : "Expand all"}
        </button>
      </div>
      <HistoryList
        ctl={ctl}
        options={options}
        groups={groups}
        expanded={expanded}
        now={Date.now()}
        onToggle={toggle}
      />
    </div>
  );
}
