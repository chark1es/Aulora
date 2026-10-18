import { highlightMatches } from "@aulora/core";
import { Badge, Button, cn, EmptyState, Icon, IconButton, SearchInput } from "@aulora/ui-web";
import { type ReactNode, useState } from "react";
import { FolderRow, Menu, TagMenu } from "./NotesLibraryMenus";
import {
  folderPath,
  type NoteFolder,
  type NoteSummary,
  ROOT,
  relativeTime,
  UNFILED,
} from "./types";
import type { NotesController } from "./use-notes";

/** The query terms highlighted inside a row's snippet. */
function HighlightedText({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim();
  if (trimmed === "") return <>{text}</>;
  return (
    <>
      {highlightMatches(text, trimmed).map((segment, index) =>
        segment.match ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional text runs
          <mark key={index} className="rounded-[3px] bg-accent-soft px-px text-accent">
            {segment.text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional text runs
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

/** The folder path label shown on a flat search result row. */
function NoteFolderPath({ ctl, note }: { ctl: NotesController; note: NoteSummary }) {
  if (!ctl.searching && !ctl.showAllNotes) return null;
  const names = folderPath(ctl.folders, note.folderId ?? UNFILED).map((folder) => folder.name);
  return (
    <span className="flex items-center gap-1 truncate text-[11px] text-text-muted">
      <Icon name="grid" size={11} />
      {names.length > 0 ? names.join(" › ") : "Unfiled"}
    </span>
  );
}

function NoteRow({ ctl, note, now }: { ctl: NotesController; note: NoteSummary; now: number }) {
  const active = ctl.noteId === note.id;
  const snippet = ctl.hitById.get(note.id)?.snippet;
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
            <Badge size="sm" tone="neutral" className="uppercase tracking-wide">
              Archived
            </Badge>
          )}
        </span>
        {snippet !== undefined && snippet.length > 0 && (
          <span className="line-clamp-2 text-[12px] leading-snug text-text-muted">
            <HighlightedText text={snippet} query={ctl.query} />
          </span>
        )}
        <NoteFolderPath ctl={ctl} note={note} />
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

function countNotes(ctl: NotesController) {
  const tagCounts = new Map<string, number>();
  for (const note of ctl.notes) {
    if (note.archived !== ctl.showArchived) continue;
    for (const id of note.tagIds) tagCounts.set(id, (tagCounts.get(id) ?? 0) + 1);
  }
  return { tagCounts };
}

interface NewMenuItemProps {
  icon: ReactNode;
  label: string;
  onSelect: () => void;
}

function NewMenuItem({ icon, label, onSelect }: NewMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-[13px] text-text transition hover:bg-surface-3"
    >
      {icon}
      {label}
    </button>
  );
}

/** What the split button's chevron offers: a note, a folder, a subfolder of the open one. */
function NewNoteMenu({ ctl, onClose }: { ctl: NotesController; onClose: () => void }) {
  const folder = ctl.currentFolder;
  const then = (action: () => void) => () => {
    onClose();
    action();
  };
  return (
    <Menu open onClose={onClose} className="right-0 top-[calc(100%+2px)] w-44 p-1">
      <NewMenuItem
        icon={<Icon name="note" size={14} />}
        label="New note"
        onSelect={then(() => void ctl.createNote())}
      />
      <NewMenuItem
        icon={<Icon name="plus" size={14} />}
        label="New folder"
        onSelect={then(() => {
          ctl.newFolderInView();
        })}
      />
      {folder !== undefined && (
        <NewMenuItem
          icon={<Icon name="plus" size={14} />}
          label="New subfolder"
          onSelect={then(() => {
            ctl.setFolderDialog({ mode: "new", parentId: folder.id });
          })}
        />
      )}
    </Menu>
  );
}

/** The 'New note' split button: a primary click plus a small creation menu. */
function NewNoteButton({ ctl }: { ctl: NotesController }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex items-center">
      <Button
        size="sm"
        className="rounded-r-none"
        leading={<Icon name="plus" size={14} />}
        loading={ctl.busy}
        onClick={() => void ctl.createNote()}
      >
        New note
      </Button>
      <Button
        size="sm"
        className="rounded-l-none px-1.5"
        aria-label="New note options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <Icon name="chevron-down" size={14} />
      </Button>
      {open && (
        <NewNoteMenu
          ctl={ctl}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function LibrarySearch({ ctl }: { ctl: NotesController }) {
  return (
    <div className="flex items-center gap-2">
      <SearchInput
        label="Search notes"
        placeholder="Search notes"
        value={ctl.query}
        onChange={ctl.setQuery}
        className="flex-1"
      />
      {ctl.canCreate && <NewNoteButton ctl={ctl} />}
    </div>
  );
}

function LibraryBreadcrumbs({ ctl }: { ctl: NotesController }) {
  const path = folderPath(ctl.folders, ctl.folderId);
  const crumb =
    "min-w-0 truncate rounded-[6px] px-1.5 py-0.5 transition hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  return (
    <nav className="flex min-w-0 items-center gap-1 text-[12px]" aria-label="Current folder">
      {path.length > 0 && (
        <IconButton
          label="Up one folder"
          size="sm"
          onClick={() => {
            ctl.openFolder(path.at(-2)?.id ?? ROOT);
          }}
        >
          <Icon name="chevron-left" size={14} />
        </IconButton>
      )}
      <button
        type="button"
        onClick={() => {
          ctl.openFolder(ROOT);
        }}
        className={cn(crumb, path.length === 0 ? "font-semibold text-text" : "text-text-muted")}
      >
        Notes
      </button>
      {path.map((folder, index) => (
        <span key={folder.id} className="flex min-w-0 items-center gap-1">
          <span className="shrink-0 text-text-muted">›</span>
          <button
            type="button"
            onClick={() => {
              ctl.openFolder(folder.id);
            }}
            className={cn(
              crumb,
              index === path.length - 1 ? "text-text" : "text-text-muted hover:text-text",
            )}
          >
            {folder.name}
          </button>
        </span>
      ))}
      {ctl.folderId === UNFILED && (
        <span className="flex min-w-0 items-center gap-1">
          <span className="shrink-0 text-text-muted">›</span>
          <span className="truncate px-1.5 font-semibold text-text">Unfiled</span>
        </span>
      )}
      <span className="flex-1" />
      <Button
        size="sm"
        variant={ctl.folderId === UNFILED ? "secondary" : "ghost"}
        aria-pressed={ctl.folderId === UNFILED}
        leading={<Icon name="file" size={13} />}
        onClick={() => {
          ctl.openFolder(ctl.folderId === UNFILED ? ROOT : UNFILED);
        }}
      >
        Unfiled
      </Button>
      <Button
        size="sm"
        variant={ctl.showAllNotes ? "secondary" : "ghost"}
        aria-pressed={ctl.showAllNotes}
        leading={<Icon name="grid" size={13} />}
        onClick={() => {
          ctl.setShowAllNotes(!ctl.showAllNotes);
        }}
      >
        All notes
      </Button>
    </nav>
  );
}

function LibraryTags({ ctl }: { ctl: NotesController }) {
  const [menu, setMenu] = useState(false);
  if (ctl.tags.length === 0 && !ctl.canEdit) return null;
  return (
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
        <div className="relative flex items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            className="h-6 gap-1 px-2 text-[11.5px]"
            leading={<Icon name="label" size={13} />}
            onClick={() => {
              ctl.setTagDialog({ mode: "new" });
            }}
          >
            Add tag
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11.5px]"
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => {
              setMenu((value) => !value);
            }}
          >
            Manage
          </Button>
          <Menu
            open={menu}
            onClose={() => {
              setMenu(false);
            }}
            className="left-0 top-[calc(100%+4px)] w-56"
          >
            <TagMenu
              ctl={ctl}
              counts={countNotes(ctl)}
              onClose={() => {
                setMenu(false);
              }}
            />
          </Menu>
        </div>
      )}
    </div>
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

function LibraryBody({ ctl, now }: { ctl: NotesController; now: number }) {
  const total = ctl.visible.length;
  const showFolders = ctl.visibleFolders.length > 0;
  if (total === 0 && !showFolders) {
    return (
      <EmptyState
        size="sm"
        icon="note"
        title={
          ctl.searching
            ? "No notes match your search"
            : ctl.showArchived
              ? "No archived notes"
              : "No notes here yet"
        }
        className="py-12"
      />
    );
  }
  const emptyLabel = ctl.searching
    ? "No notes match your search."
    : ctl.showArchived
      ? "No archived notes here."
      : "This folder is empty.";
  return (
    <ul className="flex flex-col gap-0.5 p-0.5">
      {showFolders &&
        ctl.visibleFolders.map((folder: NoteFolder) => (
          <FolderRow key={folder.id} ctl={ctl} folder={folder} now={now} />
        ))}
      {total > 0 ? (
        ctl.visible.map((note) => <NoteRow key={note.id} ctl={ctl} note={note} now={now} />)
      ) : (
        <li className="px-3 py-6 text-center text-[12px] text-text-muted">{emptyLabel}</li>
      )}
    </ul>
  );
}

export function NotesLibrary({ ctl }: { ctl: NotesController }) {
  const now = Date.now();
  const total = ctl.visible.length;
  const countLabel = `${total} ${total === 1 ? "note" : "notes"}${ctl.showArchived ? " archived" : ""}`;
  // The roomy, scannable list is the default; it narrows to a column only once
  // a note is open beside it.
  const open = ctl.noteId !== undefined;

  return (
    <aside
      className={cn(
        "min-h-0 w-full shrink-0 flex-col border-border md:flex",
        open ? "hidden md:w-[330px] md:border-r" : "flex md:border-r-0",
      )}
      aria-label="Notes"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 border-b border-border px-3 py-2.5 md:mx-0 md:max-w-none">
        <LibrarySearch ctl={ctl} />
        <LibraryBreadcrumbs ctl={ctl} />
        <LibraryTags ctl={ctl} />
      </div>

      <LibraryCountBar ctl={ctl} countLabel={countLabel} />

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <div className="mx-auto w-full max-w-3xl md:max-w-none">
          <LibraryBody ctl={ctl} now={now} />
        </div>
      </div>
    </aside>
  );
}
