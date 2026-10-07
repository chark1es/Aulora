import { Button, cn, Icon, IconButton } from "@aulora/ui-web";
import { type ReactNode, useState } from "react";
import { flattenFolders, type NoteFolder, type NoteSummary, relativeTime, UNFILED } from "./types";
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

/** A small anchored dropdown that closes on an outside click. */
function Menu({
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

function FolderRow({
  ctl,
  folder,
  depth,
  count,
  onSelect,
}: {
  ctl: NotesController;
  folder: NoteFolder;
  depth: number;
  count: number;
  onSelect: () => void;
}) {
  const active = ctl.folderId === folder.id;
  return (
    <div className="group flex items-center gap-px">
      <button
        type="button"
        data-testid={`note-folder-${folder.id}`}
        aria-current={active ? "page" : undefined}
        onClick={() => {
          ctl.setFolderId(folder.id);
          onSelect();
        }}
        style={{ paddingLeft: 12 + depth * 14 }}
        className={cn(rowClass(active), "flex-1")}
      >
        <Icon name="file" size={14} className={cn("shrink-0", active && "text-accent")} />
        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        {count > 0 && <span className="text-[11px] tabular-nums text-text-muted">{count}</span>}
      </button>
      {ctl.canEdit && (
        <>
          <IconButton
            label={`Rename ${folder.name}`}
            size="sm"
            className={actionClass}
            onClick={() => {
              ctl.setFolderDialog({ mode: "rename", folder });
            }}
          >
            <Icon name="pencil" size={13} />
          </IconButton>
          <IconButton
            label={`Move ${folder.name}`}
            size="sm"
            className={actionClass}
            onClick={() => {
              ctl.setFolderDialog({ mode: "move", folder });
            }}
          >
            <Icon name="arrow-up" size={13} />
          </IconButton>
        </>
      )}
      {ctl.canDelete && (
        <IconButton
          label={`Delete ${folder.name}`}
          size="sm"
          variant="danger"
          className={actionClass}
          onClick={() => {
            ctl.requestDeleteFolder(folder);
          }}
        >
          <Icon name="trash" size={13} />
        </IconButton>
      )}
    </div>
  );
}

function TagRow({
  ctl,
  tag,
  count,
  onSelect,
}: {
  ctl: NotesController;
  tag: NotesController["tags"][number];
  count: number;
  onSelect?: () => void;
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
          onSelect?.();
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

/** The folder path from the root to the selected folder, for the breadcrumb. */
function folderPath(folders: readonly NoteFolder[], folderId: NotesController["folderId"]) {
  if (folderId === undefined || folderId === UNFILED) return [];
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: NoteFolder[] = [];
  let current = byId.get(folderId);
  while (current !== undefined) {
    path.unshift(current);
    current = current.parentId !== null ? byId.get(current.parentId) : undefined;
  }
  return path;
}

/**
 * The single Notes navigation column: a breadcrumb scope, search, tag filters
 * and the note list. Folders and tags are managed from small dropdown menus
 * rather than a standing tree, so the view stays to one column.
 */
export function NotesLibrary({ ctl }: { ctl: NotesController }) {
  const [folderMenu, setFolderMenu] = useState(false);
  const [tagMenu, setTagMenu] = useState(false);
  const now = Date.now();
  const tree = flattenFolders(ctl.folders);

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

  const newFolderParent =
    ctl.folderId !== undefined && ctl.folderId !== UNFILED ? ctl.folderId : null;
  const path = folderPath(ctl.folders, ctl.folderId);
  const total = ctl.visible.length;
  const countLabel = `${total} ${total === 1 ? "note" : "notes"}${ctl.showArchived ? " archived" : ""}`;
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
    crumbs.push({ key: "unfiled", label: "Unfiled", onClick: () => ctl.setFolderId(UNFILED) });
  }

  return (
    <aside
      className={cn(
        "min-h-0 w-full shrink-0 flex-col border-r border-border md:flex md:w-[330px]",
        ctl.noteId !== undefined ? "hidden" : "flex",
      )}
      aria-label="Notes"
    >
      <div className="relative flex flex-col gap-2 border-b border-border px-3 py-2.5">
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

        <div className="flex min-w-0 items-center gap-1 text-[12px]">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={folderMenu}
            onClick={() => {
              setFolderMenu((value) => !value);
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
              setFolderMenu((value) => !value);
            }}
          >
            <Icon name="chevron-down" size={14} />
          </IconButton>
        </div>

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
                  setTagMenu((value) => !value);
                }}
              >
                <Icon name="plus" size={14} />
              </IconButton>
            )}
          </div>
        )}

        <Menu
          open={folderMenu}
          onClose={() => {
            setFolderMenu(false);
          }}
          className="left-3 right-3 top-[46px]"
        >
          <button
            type="button"
            aria-current={ctl.folderId === undefined ? "page" : undefined}
            onClick={() => {
              ctl.setFolderId(undefined);
              setFolderMenu(false);
            }}
            className={cn(rowClass(ctl.folderId === undefined), "w-full pl-3")}
          >
            <Icon name="note" size={14} />
            <span className="min-w-0 flex-1 truncate">All notes</span>
            {allCount > 0 && (
              <span className="text-[11px] tabular-nums text-text-muted">{allCount}</span>
            )}
          </button>
          <button
            type="button"
            aria-current={ctl.folderId === UNFILED ? "page" : undefined}
            onClick={() => {
              ctl.setFolderId(UNFILED);
              setFolderMenu(false);
            }}
            className={cn(rowClass(ctl.folderId === UNFILED), "w-full pl-3")}
          >
            <Icon name="file" size={14} />
            <span className="min-w-0 flex-1 truncate">Unfiled</span>
            {unfiledCount > 0 && (
              <span className="text-[11px] tabular-nums text-text-muted">{unfiledCount}</span>
            )}
          </button>
          {tree.map(({ folder, depth }) => (
            <FolderRow
              key={folder.id}
              ctl={ctl}
              folder={folder}
              depth={depth}
              count={directCounts.get(folder.id) ?? 0}
              onSelect={() => {
                setFolderMenu(false);
              }}
            />
          ))}
          {tree.length === 0 && (
            <p className="px-3 py-1.5 text-xs text-text-muted">No folders yet</p>
          )}
          {ctl.canCreate && (
            <div className="mt-1 border-t border-border pt-1">
              <button
                type="button"
                onClick={() => {
                  ctl.setFolderDialog({ mode: "new", parentId: newFolderParent });
                  setFolderMenu(false);
                }}
                className={cn(rowClass(false), "w-full pl-3")}
              >
                <Icon name="plus" size={14} />
                <span className="min-w-0 flex-1 truncate">New folder</span>
              </button>
            </div>
          )}
        </Menu>

        <Menu
          open={tagMenu}
          onClose={() => {
            setTagMenu(false);
          }}
          className="left-3 right-3 top-[46px]"
        >
          {ctl.tags.map((tag) => (
            <TagRow key={tag.id} ctl={ctl} tag={tag} count={tagCounts.get(tag.id) ?? 0} />
          ))}
          {ctl.tags.length === 0 && (
            <p className="px-3 py-1.5 text-xs text-text-muted">No tags yet</p>
          )}
          <div className="mt-1 border-t border-border pt-1">
            <button
              type="button"
              onClick={() => {
                ctl.setTagDialog({ mode: "new" });
                setTagMenu(false);
              }}
              className={cn(rowClass(false), "w-full pl-3")}
            >
              <Icon name="plus" size={14} />
              <span className="min-w-0 flex-1 truncate">New tag</span>
            </button>
          </div>
        </Menu>
      </div>

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
