import { Button, cn, Icon, IconButton } from "@aulora/ui-web";
import { useState } from "react";
import { FolderMenu, type LibraryCounts, Menu, TagMenu } from "./NotesLibraryMenus";
import { folderPath, type NoteSummary, relativeTime, UNFILED } from "./types";
import type { NotesController } from "./use-notes";

function NoteRow({ ctl, note, now }: { ctl: NotesController; note: NoteSummary; now: number }) {
  const active = ctl.noteId === note.id;
  const snippet = ctl.hitById.get(note.id)?.snippet ?? "";
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
          ctl.openNote(note.id);
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

function countNotes(ctl: NotesController): LibraryCounts {
  const directCounts = new Map<string, number>();
  let allCount = 0;
  let unfiledCount = 0;
  for (const note of ctl.notes) {
    if (note.archived !== ctl.showArchived) continue;
    allCount += 1;
    if (note.folderId === null) {
      unfiledCount += 1;
    } else {
      directCounts.set(note.folderId, (directCounts.get(note.folderId) ?? 0) + 1);
    }
  }
  const tagCounts = new Map<string, number>();
  for (const note of ctl.notes) {
    if (note.archived !== ctl.showArchived) continue;
    for (const id of note.tagIds) tagCounts.set(id, (tagCounts.get(id) ?? 0) + 1);
  }

  return { directCounts, tagCounts, allCount, unfiledCount };
}

function LibrarySearch({ ctl }: { ctl: NotesController }) {
  return (
    <div className="flex items-center gap-2">
      <label className="relative block flex-1">
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
      {ctl.canCreate && (
        <Button
          size="sm"
          leading={<Icon name="plus" size={14} />}
          loading={ctl.busy}
          onClick={() => void ctl.createNote()}
        >
          New note
        </Button>
      )}
    </div>
  );
}

function LibraryBreadcrumbs({
  ctl,
  open,
  onToggle,
}: {
  ctl: NotesController;
  open: boolean;
  onToggle: () => void;
}) {
  const path = folderPath(ctl.folders, ctl.folderId);
  const crumbs: { key: string; label: string; onClick: () => void }[] = [];
  for (const folder of path) {
    crumbs.push({
      key: folder.id,
      label: folder.name,
      onClick: () => {
        ctl.setFolderId(folder.id);
      },
    });
  }
  if (ctl.folderId === UNFILED) {
    crumbs.push({
      key: "unfiled",
      label: "Unfiled",
      onClick: () => {
        ctl.setFolderId(UNFILED);
      },
    });
  }

  return (
    <div className="flex min-w-0 items-center gap-1 text-[12px]">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          onToggle();
        }}
        className="shrink-0 rounded-[6px] px-1.5 py-0.5 font-semibold text-text transition hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Notes
      </button>
      {crumbs.map((crumb) => (
        <span key={crumb.key} className="flex min-w-0 items-center gap-1">
          <span className="shrink-0 text-text-muted">›</span>
          <button
            type="button"
            onClick={crumb.onClick}
            className="min-w-0 truncate rounded-[6px] px-1.5 py-0.5 text-text-muted transition hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {crumb.label}
          </button>
        </span>
      ))}
      <span className="flex-1" />
      <IconButton
        label="Choose folder"
        size="sm"
        onClick={() => {
          onToggle();
        }}
      >
        <Icon name="chevron-down" size={14} />
      </IconButton>
    </div>
  );
}

function LibraryTags({ ctl, onToggle }: { ctl: NotesController; onToggle: () => void }) {
  return (
    <>
      {(ctl.tags.length > 0 || ctl.canEdit) && (
        <div className="flex flex-wrap items-center gap-1">
          {ctl.tags.map((tag) => {
            const active = ctl.tagId === tag.id;
            return (
              <button
                key={tag.id}
                type="button"
                data-testid={`note-tag-${tag.id}`}
                aria-pressed={active}
                onClick={() => {
                  ctl.setTagId(active ? undefined : tag.id);
                }}
                className={cn(
                  "inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11.5px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  active
                    ? "border-accent/40 bg-accent-soft font-semibold text-accent"
                    : "border-border text-text-muted hover:bg-surface-3 hover:text-text",
                )}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                {tag.name}
              </button>
            );
          })}
          {ctl.canEdit && (
            <IconButton
              label="Manage tags"
              size="sm"
              onClick={() => {
                onToggle();
              }}
            >
              <Icon name="plus" size={14} />
            </IconButton>
          )}
        </div>
      )}
    </>
  );
}

function LibraryCountBar({ ctl, countLabel }: { ctl: NotesController; countLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
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
  );
}

function LibraryNavigation({ ctl, counts }: { ctl: NotesController; counts: LibraryCounts }) {
  const [folderMenu, setFolderMenu] = useState(false);
  const [tagMenu, setTagMenu] = useState(false);
  return (
    <div className="relative flex flex-col gap-2 border-b border-border px-3 py-2.5">
      <LibrarySearch ctl={ctl} />
      <LibraryBreadcrumbs
        ctl={ctl}
        open={folderMenu}
        onToggle={() => {
          setFolderMenu((value) => !value);
        }}
      />
      <LibraryTags
        ctl={ctl}
        onToggle={() => {
          setTagMenu((value) => !value);
        }}
      />
      <Menu
        open={folderMenu}
        onClose={() => {
          setFolderMenu(false);
        }}
        className="left-3 right-3 top-[46px]"
      >
        <FolderMenu
          ctl={ctl}
          counts={counts}
          onClose={() => {
            setFolderMenu(false);
          }}
        />
      </Menu>
      <Menu
        open={tagMenu}
        onClose={() => {
          setTagMenu(false);
        }}
        className="left-3 right-3 top-[46px]"
      >
        <TagMenu
          ctl={ctl}
          counts={counts}
          onClose={() => {
            setTagMenu(false);
          }}
        />
      </Menu>
    </div>
  );
}

export function NotesLibrary({ ctl }: { ctl: NotesController }) {
  const now = Date.now();
  const counts = countNotes(ctl);
  const total = ctl.visible.length;
  const countLabel = `${total} ${total === 1 ? "note" : "notes"}${ctl.showArchived ? " archived" : ""}`;

  return (
    <aside
      className={cn(
        "min-h-0 w-full shrink-0 flex-col border-r border-border md:flex md:w-[330px]",
        ctl.noteId !== undefined ? "hidden" : "flex",
      )}
      aria-label="Notes"
    >
      <LibraryNavigation ctl={ctl} counts={counts} />

      <LibraryCountBar ctl={ctl} countLabel={countLabel} />

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {total === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
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
          <ul className="flex flex-col gap-0.5 p-0.5">
            {ctl.visible.map((note) => (
              <NoteRow key={note.id} ctl={ctl} note={note} now={now} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
