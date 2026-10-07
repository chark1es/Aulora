import { Button, cn, Icon, IconButton } from "@aulora/ui-web";
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

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-3">
      <div className="flex items-center justify-between py-1 pl-1.5 pr-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
          {title}
        </span>
        {action}
      </div>
      {children}
    </section>
  );
}

function FolderRow({
  ctl,
  folder,
  depth,
  count,
}: {
  ctl: NotesController;
  folder: NoteFolder;
  depth: number;
  count: number;
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

/** Folders, tags and the create actions for the Notes view. */
export function NotesSidebar({ ctl }: { ctl: NotesController }) {
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

  return (
    <aside
      className="hidden min-h-0 w-[232px] shrink-0 flex-col border-r border-border md:flex"
      aria-label="Note folders"
    >
      <div className="flex flex-col gap-2 px-3 py-3">
        {ctl.canCreate && (
          <>
            <Button
              size="sm"
              leading={<Icon name="plus" size={14} />}
              loading={ctl.busy}
              onClick={() => void ctl.createNote()}
            >
              New note
            </Button>
            <Button
              size="sm"
              variant="secondary"
              leading={<Icon name="plus" size={14} />}
              onClick={() => {
                ctl.setFolderDialog({ mode: "new", parentId: newFolderParent });
              }}
            >
              New folder
            </Button>
          </>
        )}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <Section title="Folders">
          <button
            type="button"
            aria-current={ctl.folderId === undefined ? "page" : undefined}
            onClick={() => {
              ctl.setFolderId(undefined);
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
            />
          ))}
          {tree.length === 0 && (
            <p className="px-3 py-1.5 text-xs text-text-muted">No folders yet</p>
          )}
        </Section>

        <Section
          title="Tags"
          action={
            ctl.canEdit ? (
              <IconButton
                label="New tag"
                size="sm"
                onClick={() => {
                  ctl.setTagDialog({ mode: "new" });
                }}
              >
                <Icon name="plus" size={14} />
              </IconButton>
            ) : null
          }
        >
          {ctl.tags.map((tag) => (
            <TagRow key={tag.id} ctl={ctl} tag={tag} count={tagCounts.get(tag.id) ?? 0} />
          ))}
          {ctl.tags.length === 0 && (
            <p className="px-3 py-1.5 text-xs text-text-muted">No tags yet</p>
          )}
        </Section>
      </nav>
    </aside>
  );
}
