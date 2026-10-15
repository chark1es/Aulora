import { type DiffLine, diffLines, diffStats } from "@aulora/core";
import { cn, Spinner } from "@aulora/ui-web";
import { useMemo } from "react";
import { formatTimestamp, type NoteRevision } from "./types";
import type { NotesController } from "./use-notes";

const ACTION_LABELS: Record<NoteRevision["action"], string> = {
  created: "created this note",
  updated: "edited this note",
  renamed: "renamed this note",
  moved: "moved this note",
  tagged: "changed the tags",
  archived: "archived this note",
  restored: "restored this note",
  deleted: "deleted this note",
};

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

function RevisionRow({ ctl, revision }: { ctl: NotesController; revision: NoteRevision }) {
  const actor =
    ctl.members.find((member) => member.userId === revision.actorId)?.displayName ??
    "Former member";
  const { before, after } = revision;
  const bodyBefore = before?.body ?? "";
  const bodyAfter = after?.body ?? "";
  const titleChanged = before !== null && after !== null && before.title !== after.title;
  return (
    <li className="flex flex-col gap-1.5 border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] text-text">
          <span className="font-medium">{actor}</span> {ACTION_LABELS[revision.action]}
        </p>
        <time className="shrink-0 text-[11px] text-text-muted">{formatTimestamp(revision.at)}</time>
      </div>
      {titleChanged && (
        <p className="text-[12px] text-text-muted">
          Title: <span className="text-danger line-through">{before.title}</span>{" "}
          <span className="text-secondary">{after.title}</span>
        </p>
      )}
      {bodyBefore !== bodyAfter && <DiffView before={bodyBefore} after={bodyAfter} />}
    </li>
  );
}

/** Every recorded change to the open note, newest first, with a line diff. */
export function NoteHistory({ ctl }: { ctl: NotesController }) {
  const revisions = ctl.history;
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
    <ul className="flex flex-col">
      {revisions.map((revision) => (
        <RevisionRow key={revision.id} ctl={ctl} revision={revision} />
      ))}
    </ul>
  );
}
