import { cn, Icon, IconButton } from "@aulora/ui-web";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { type NoteFolder, relativeTime } from "./types";
import type { NotesController } from "./use-notes";

const rowClass = (active: boolean) =>
  cn(
    "flex h-8 min-w-0 items-center gap-2 rounded-[8px] pr-2 text-left text-[13px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
    active
      ? "bg-surface-3 font-semibold text-text"
      : "text-text-muted hover:bg-surface-3 hover:text-text",
  );

const actionClass =
  "shrink-0 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100";

/** Moves focus between the menu items with the arrow keys, Home and End. */
function useMenuKeys(ref: RefObject<HTMLDivElement | null>, open: boolean, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    if (node === null) return;
    const items = () => [
      ...node.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'),
    ];
    items()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      const list = items();
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
        return;
      }
      if (list.length === 0) return;
      const current = list.findIndex((item) => item === document.activeElement);
      const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (step !== 0) {
        event.preventDefault();
        const next = (current + step + list.length) % list.length;
        list.at(next)?.focus();
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        list[0]?.focus();
      } else if (event.key === "End") {
        event.preventDefault();
        list.at(-1)?.focus();
      }
    };
    node.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
    };
  }, [ref, open]);
}

/** A small anchored dropdown that closes on an outside click or Escape. */
export function Menu({
  open,
  onClose,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useMenuKeys(ref, open, onClose);
  if (!open) return null;
  return (
    <>
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default"
      />
      <div
        ref={ref}
        role="menu"
        className={cn(
          "absolute z-50 max-h-[360px] overflow-y-auto rounded-[12px] border border-border bg-surface-2 p-1.5 shadow-xl",
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}

function TagRow({
  ctl,
  tag,
  count,
}: {
  ctl: NotesController;
  tag: NotesController["tags"][number];
  count: number;
}) {
  const active = ctl.tagId === tag.id;
  return (
    <div className="group flex items-center gap-px">
      <button
        type="button"
        data-testid={`note-tag-${tag.id}`}
        aria-pressed={active}
        onClick={() => {
          ctl.setTagId(active ? undefined : tag.id);
        }}
        className={cn(rowClass(active), "flex-1 pl-3")}
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: tag.color }}
        />
        <span className="min-w-0 flex-1 truncate">{tag.name}</span>
        {count > 0 && <span className="text-[11px] tabular-nums text-text-muted">{count}</span>}
      </button>
      {ctl.canEdit && (
        <IconButton
          label={`Edit ${tag.name}`}
          size="sm"
          className={actionClass}
          onClick={() => {
            ctl.setTagDialog({ mode: "edit", tag });
          }}
        >
          <Icon name="pencil" size={13} />
        </IconButton>
      )}
      {ctl.canDelete && (
        <IconButton
          label={`Delete ${tag.name}`}
          size="sm"
          variant="danger"
          className={actionClass}
          onClick={() => {
            ctl.requestDeleteTag(tag);
          }}
        >
          <Icon name="trash" size={13} />
        </IconButton>
      )}
    </div>
  );
}

export interface LibraryCounts {
  tagCounts: ReadonlyMap<string, number>;
}

/** The tag-management list behind the library's 'Manage' affordance. */
export function TagMenu({
  ctl,
  counts,
  onClose,
}: {
  ctl: NotesController;
  counts: LibraryCounts;
  onClose: () => void;
}) {
  const { tagCounts } = counts;
  return (
    <>
      {ctl.tags.map((tag) => (
        <TagRow key={tag.id} ctl={ctl} tag={tag} count={tagCounts.get(tag.id) ?? 0} />
      ))}
      {ctl.tags.length === 0 && <p className="px-3 py-1.5 text-xs text-text-muted">No tags yet</p>}
      <div className="mt-1 border-t border-border pt-1">
        <button
          type="button"
          onClick={() => {
            ctl.setTagDialog({ mode: "new" });
            onClose();
          }}
          className={cn(rowClass(false), "w-full pl-3")}
        >
          <Icon name="plus" size={14} />
          <span className="min-w-0 flex-1 truncate">New tag</span>
        </button>
      </div>
    </>
  );
}

/** The hover menu on a folder row: rename, move, add a subfolder or delete. */
function FolderActionsMenu({
  ctl,
  folder,
  open,
  onClose,
}: {
  ctl: NotesController;
  folder: NoteFolder;
  open: boolean;
  onClose: () => void;
}) {
  const item = "flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-[13px]";
  return (
    <Menu open={open} onClose={onClose} className="right-1 top-[calc(100%-4px)] w-44 p-1">
      {ctl.canEdit && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              ctl.setFolderDialog({ mode: "rename", folder });
            }}
            className={cn(item, "text-text transition hover:bg-surface-3")}
          >
            <Icon name="pencil" size={14} />
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              ctl.setFolderDialog({ mode: "move", folder });
            }}
            className={cn(item, "text-text transition hover:bg-surface-3")}
          >
            <Icon name="arrow-up" size={14} />
            Move
          </button>
        </>
      )}
      {ctl.canCreate && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            ctl.setFolderDialog({ mode: "new", parentId: folder.id });
          }}
          className={cn(item, "text-text transition hover:bg-surface-3")}
        >
          <Icon name="plus" size={14} />
          New subfolder
        </button>
      )}
      {ctl.canDelete && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            ctl.requestDeleteFolder(folder);
          }}
          className={cn(item, "text-danger transition hover:bg-danger/10")}
        >
          <Icon name="trash" size={14} />
          Delete
        </button>
      )}
    </Menu>
  );
}

/** "2 folders · 3 notes", or "Empty" with when its newest note changed. */
function folderSubtitle(ctl: NotesController, folder: NoteFolder, now: number) {
  const childCount = ctl.folders.filter((entry) => entry.parentId === folder.id).length;
  const notes = ctl.notes.filter(
    (note) => note.folderId === folder.id && note.archived === ctl.showArchived,
  );
  const parts = [
    childCount > 0 ? `${childCount} ${childCount === 1 ? "folder" : "folders"}` : undefined,
    notes.length > 0 ? `${notes.length} ${notes.length === 1 ? "note" : "notes"}` : undefined,
  ].filter((value): value is string => value !== undefined);
  if (parts.length > 0) return parts.join(" · ");
  const recent = [...notes].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return `Empty${recent !== undefined ? ` · ${relativeTime(recent.updatedAt, now)}` : ""}`;
}

/** A subfolder row in the file explorer: name, item counts and a drill-in chevron. */
export function FolderRow({
  ctl,
  folder,
  now,
}: {
  ctl: NotesController;
  folder: NoteFolder;
  now: number;
}) {
  const [menu, setMenu] = useState(false);
  const subtitle = folderSubtitle(ctl, folder, now);
  return (
    <li className="group relative flex items-center gap-px">
      <button
        type="button"
        data-testid={`note-folder-${folder.id}`}
        aria-label={`Open folder ${folder.name}`}
        onClick={() => {
          ctl.openFolder(folder.id);
        }}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-3 py-2 text-left transition hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Icon name="file" size={16} className="shrink-0 text-accent" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-medium text-text">{folder.name}</span>
          <span className="truncate text-[11px] text-text-muted">{subtitle}</span>
        </span>
        <Icon name="chevron-right" size={16} className="shrink-0 text-text-muted" />
      </button>
      <IconButton
        label={`${folder.name} actions`}
        size="sm"
        aria-haspopup="menu"
        aria-expanded={menu}
        className={cn(actionClass, menu && "opacity-100")}
        onClick={() => {
          setMenu((value) => !value);
        }}
      >
        <Icon name="more-horizontal" size={15} />
      </IconButton>
      <FolderActionsMenu
        ctl={ctl}
        folder={folder}
        open={menu}
        onClose={() => {
          setMenu(false);
        }}
      />
    </li>
  );
}
