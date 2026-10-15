import { cn, Icon, IconButton } from "@aulora/ui-web";
import type { ReactNode } from "react";
import { flattenFolders, type NoteFolder, UNFILED } from "./types";
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

export interface LibraryCounts {
  directCounts: ReadonlyMap<string, number>;
  tagCounts: ReadonlyMap<string, number>;
  allCount: number;
  unfiledCount: number;
}

export function FolderMenu({
  ctl,
  counts,
  onClose,
}: {
  ctl: NotesController;
  counts: LibraryCounts;
  onClose: () => void;
}) {
  const { directCounts, allCount, unfiledCount } = counts;
  const tree = flattenFolders(ctl.folders);
  const newFolderParent =
    ctl.folderId !== undefined && ctl.folderId !== UNFILED ? ctl.folderId : null;
  return (
    <>
      <button
        type="button"
        aria-current={ctl.folderId === undefined ? "page" : undefined}
        onClick={() => {
          ctl.setFolderId(undefined);
          onClose();
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
          onClose();
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
            onClose();
          }}
        />
      ))}
      {tree.length === 0 && <p className="px-3 py-1.5 text-xs text-text-muted">No folders yet</p>}
      {ctl.canCreate && (
        <div className="mt-1 border-t border-border pt-1">
          <button
            type="button"
            onClick={() => {
              ctl.setFolderDialog({ mode: "new", parentId: newFolderParent });
              onClose();
            }}
            className={cn(rowClass(false), "w-full pl-3")}
          >
            <Icon name="plus" size={14} />
            <span className="min-w-0 flex-1 truncate">New folder</span>
          </button>
        </div>
      )}
    </>
  );
}
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
