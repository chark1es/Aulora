import { Button, cn, Icon } from "@aulora/ui-web";
import { type NoteSummary, relativeTime } from "./types";
import type { NotesController } from "./use-notes";

function NoteRow({ ctl, note, now }: { ctl: NotesController; note: NoteSummary; now: number }) {
  const active = ctl.noteId === note.id;
  const hit = ctl.hitById.get(note.id);
  const snippet = hit?.snippet ?? "";
  const tags = note.tagIds
    .map((id) => ctl.tags.find((tag) => tag.id === id))
    .filter((tag): tag is NonNullable<typeof tag> => tag !== undefined);
  return (
    <li>
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        aria-label={`Open note ${note.title}`}
        onClick={() => {
          ctl.setNoteId(note.id);
        }}
        className={cn(
          "flex w-full flex-col gap-1 rounded-[10px] border px-3 py-2 text-left transition",
          active ? "border-accent/40 bg-accent-soft" : "border-transparent hover:bg-surface-3",
        )}
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">
            {note.title.trim().length > 0 ? note.title : "Untitled note"}
          </span>
          {note.archived && (
            <span className="shrink-0 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
              Archived
            </span>
          )}
        </span>
        {snippet.length > 0 && (
          <span className="line-clamp-2 text-[12px] leading-snug text-text-muted">{snippet}</span>
        )}
        <span className="flex items-center gap-1.5">
          {tags.slice(0, 3).map((tag) => (
            <span
              key={tag.id}
              className="inline-flex max-w-[110px] items-center gap-1 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-text-muted"
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: tag.color }}
              />
              <span className="truncate">{tag.name}</span>
            </span>
          ))}
          <span className="ml-auto shrink-0 text-[11px] text-text-muted">
            {relativeTime(note.updatedAt, now)}
          </span>
        </span>
      </button>
    </li>
  );
}

/** The middle column: search, an active/archived switch and the filtered note list. */
export function NoteList({ ctl }: { ctl: NotesController }) {
  const now = Date.now();
  const total = ctl.visible.length;
  const countLabel = `${total} ${total === 1 ? "note" : "notes"}${ctl.showArchived ? " archived" : ""}`;
  return (
    <section
      className={cn(
        "min-h-0 w-full shrink-0 flex-col border-r border-border md:flex md:w-[300px]",
        ctl.noteId !== undefined ? "hidden" : "flex",
      )}
      aria-label="Notes list"
    >
      <div className="flex flex-col gap-2 border-b border-border px-3 py-3">
        <label className="relative block">
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            aria-label="Search notes"
            placeholder="Search notes"
            value={ctl.query}
            onChange={(event) => {
              ctl.setQuery(event.target.value);
            }}
            className="h-8 w-full rounded-[8px] border border-border bg-surface-2 pl-8 pr-2.5 text-[13px] text-text placeholder:text-text-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          />
        </label>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] tabular-nums text-text-muted">{countLabel}</span>
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={ctl.showArchived}
            leading={<Icon name="archive" size={13} />}
            onClick={() => {
              ctl.setShowArchived(!ctl.showArchived);
            }}
          >
            {ctl.showArchived ? "Active" : "Archived"}
          </Button>
        </div>
      </div>

      {total === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <Icon name="note" size={24} className="text-text-muted" />
          <p className="text-[13px] text-text-muted">
            {ctl.query.trim().length > 0
              ? "No notes match your search."
              : ctl.showArchived
                ? "No archived notes."
                : "No notes here yet."}
          </p>
        </div>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
          {ctl.visible.map((note) => (
            <NoteRow key={note.id} ctl={ctl} note={note} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}
