/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, Input } from "@aulora/ui-native";
import { useState } from "react";
import { View } from "react-native";
import { archiveActionLabel, folderChildren, noteTitle } from "../../lib/notes";
import { confirm } from "../kanban/board-menus";
import { PickerSheet } from "../kanban/PickerSheet";
import { ActionSheet, BottomSheet, type SheetAction } from "../kanban/sheets";
import { TagManager } from "./NoteTagManager";
import type { NoteFolderView, NoteListItem, NotesController } from "./use-notes";

const ROOT = "__root__";

/** The tags inside a folder and everything it contains, so a move cannot cycle. */
function descendantIds(folders: readonly NoteFolderView[], rootId: string): Set<string> {
  const found = new Set<string>();
  const walk = (id: string) => {
    for (const child of folderChildren(folders, id)) {
      if (found.has(child.id)) continue;
      found.add(child.id);
      walk(child.id);
    }
  };
  walk(rootId);
  return found;
}

function noteActions(ctl: NotesController, note: NoteListItem): SheetAction[] {
  const actions: SheetAction[] = [
    {
      id: "open",
      label: "Open note",
      icon: "expand",
      onPress: () => {
        ctl.openNote(note.id);
      },
    },
    {
      id: "history",
      label: "View history…",
      icon: "history",
      section: true,
      onPress: () => {
        ctl.openHistory(note.id);
      },
    },
  ];
  if (ctl.permissions.edit)
    actions.push({
      id: "archive",
      label: archiveActionLabel(note.archived),
      icon: note.archived ? "unarchive" : "archive",
      onPress: () => {
        void ctl.run(() =>
          ctl.mutations.archiveNote({ noteId: note.id, archived: !note.archived }),
        );
      },
    });
  if (ctl.permissions.remove)
    actions.push({
      id: "delete",
      label: "Delete note…",
      icon: "trash",
      danger: true,
      onPress: () => {
        confirm(
          "Permanently delete note?",
          "This deletes the note and its history. It cannot be undone.",
          "Delete note",
          () => {
            void ctl
              .run(() => ctl.mutations.deleteNote({ noteId: note.id }))
              .then((deleted) => {
                if (deleted) ctl.closeNote();
              });
          },
        );
      },
    });
  return actions;
}

function folderActions(ctl: NotesController, folder: NoteFolderView): SheetAction[] {
  const actions: SheetAction[] = [];
  if (ctl.permissions.create)
    actions.push({
      id: "subfolder",
      label: "New subfolder",
      icon: "plus",
      onPress: () => {
        ctl.setOpen({ kind: "folderForm", folderId: null, parentId: folder.id });
      },
    });
  if (ctl.permissions.edit) {
    actions.push({
      id: "rename",
      label: "Rename folder…",
      icon: "pencil",
      ...(actions.length === 0 ? { section: true as const } : {}),
      onPress: () => {
        ctl.setOpen({ kind: "folderForm", folderId: folder.id, parentId: folder.parentId });
      },
    });
    actions.push({
      id: "move",
      label: "Move folder…",
      icon: "grid",
      onPress: () => {
        ctl.setOpen({ kind: "moveFolder", folderId: folder.id });
      },
    });
  }
  if (ctl.permissions.remove)
    actions.push({
      id: "delete",
      label: "Delete folder…",
      icon: "trash",
      danger: true,
      onPress: () => {
        confirm(
          "Delete folder?",
          "The folder must be empty. Move or delete its notes and subfolders first.",
          "Delete folder",
          () => {
            void ctl
              .run(() => ctl.mutations.deleteFolder({ folderId: folder.id }))
              .then((deleted) => {
                if (deleted && ctl.filters.folderId === folder.id)
                  ctl.setFilters({ ...ctl.filters, folderId: undefined });
              });
          },
        );
      },
    });
  return actions;
}

function moreActions(ctl: NotesController): SheetAction[] {
  const actions: SheetAction[] = [];
  if (ctl.permissions.create) {
    actions.push({
      id: "new-note",
      label: "New note",
      icon: "plus",
      onPress: ctl.newNote,
    });
    actions.push({
      id: "new-folder",
      label: "New folder",
      icon: "plus",
      onPress: () => {
        ctl.setOpen({
          kind: "folderForm",
          folderId: null,
          parentId: ctl.filters.folderId ?? null,
        });
      },
    });
  }
  if (ctl.permissions.edit)
    actions.push({
      id: "tags",
      label: "Manage tags…",
      icon: "label",
      section: true,
      onPress: () => {
        ctl.setOpen({ kind: "tags" });
      },
    });
  actions.push({
    id: "archived",
    label: ctl.filters.archived ? "Show active notes" : "Show archived notes",
    icon: ctl.filters.archived ? "note" : "archive",
    ...(ctl.permissions.edit ? {} : { section: true as const }),
    onPress: () => {
      ctl.setFilters({ ...ctl.filters, archived: !ctl.filters.archived });
    },
  });
  const orders = [
    { order: "updated" as const, label: "Recently updated" },
    { order: "created" as const, label: "Recently created" },
    { order: "title" as const, label: "Title (A–Z)" },
  ];
  for (const entry of orders) {
    actions.push({
      id: `sort-${entry.order}`,
      label: entry.label,
      section: entry.order === "updated" ? "Sort by" : undefined,
      ...(ctl.order === entry.order ? { icon: "check" as const } : {}),
      onPress: () => {
        ctl.setOrder(entry.order);
      },
    });
  }
  return actions;
}

function FolderForm({
  ctl,
  onClose,
  folderId,
  parentId,
}: {
  readonly ctl: NotesController;
  readonly onClose: () => void;
  readonly folderId: string | null;
  readonly parentId: string | null;
}) {
  const existing = folderId === null ? undefined : ctl.folders.find((f) => f.id === folderId);
  const [name, setName] = useState(existing?.name ?? "");
  const [busy, setBusy] = useState(false);
  const submit = () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const work =
      folderId === null
        ? () =>
            ctl.mutations.createFolder({
              name,
              ...(parentId !== null ? { parentId: parentId as never } : {}),
            })
        : () => ctl.mutations.renameFolder({ folderId: folderId as never, name });
    void ctl.run(work).then((saved) => {
      setBusy(false);
      if (saved) onClose();
    });
  };
  return (
    <BottomSheet title={folderId === null ? "New folder" : "Rename folder"} onClose={onClose}>
      <View className="gap-4 p-4">
        <Input
          label="Folder name"
          placeholder="e.g. Meeting notes"
          autoFocus
          maxLength={80}
          returnKeyType="done"
          value={name}
          onChangeText={setName}
          onSubmitEditing={submit}
        />
        <Button loading={busy} disabled={!name.trim()} onPress={submit}>
          {folderId === null ? "Create folder" : "Save name"}
        </Button>
      </View>
    </BottomSheet>
  );
}

function MoveFolderPicker({
  ctl,
  onClose,
  folderId,
}: {
  readonly ctl: NotesController;
  readonly onClose: () => void;
  readonly folderId: string;
}) {
  const folder = ctl.folders.find((entry) => entry.id === folderId);
  const blocked = descendantIds(ctl.folders, folderId);
  blocked.add(folderId);
  const selected = folder?.parentId ?? ROOT;
  return (
    <PickerSheet
      title="Move folder"
      options={[
        { id: ROOT, label: "No folder (top level)" },
        ...ctl.flatFolders
          .filter((entry) => !blocked.has(entry.folder.id))
          .map((entry) => ({
            id: entry.folder.id,
            label: `${"  ".repeat(entry.depth)}${entry.folder.name}`,
          })),
      ]}
      selected={[selected]}
      onChange={(next) => {
        const id = next.at(0);
        void ctl
          .run(() =>
            ctl.mutations.moveFolder({
              folderId: folderId as never,
              ...(id !== undefined && id !== ROOT ? { parentId: id as never } : {}),
            }),
          )
          .then((moved) => {
            if (moved) onClose();
          });
      }}
      onClose={onClose}
    />
  );
}

/** Whichever menu, filter or form is open over the notes list. */
export function NotesSheets({ ctl }: { readonly ctl: NotesController }) {
  const open = ctl.open;
  const onClose = () => {
    ctl.setOpen(undefined);
  };
  if (open === undefined) return null;
  if (open.kind === "more")
    return <ActionSheet title="Notes" actions={moreActions(ctl)} onClose={onClose} />;
  if (open.kind === "tagFilter")
    return (
      <PickerSheet
        multiple
        title="Filter by tag"
        emptyText="No tags yet"
        options={ctl.tags.map((tag) => ({
          id: tag.id,
          label: tag.name,
          leading: <View className="h-3 w-3 rounded-pill" style={{ backgroundColor: tag.color }} />,
        }))}
        selected={ctl.filters.tagIds}
        onChange={(tagIds) => {
          ctl.setFilters({ ...ctl.filters, tagIds });
        }}
        onClose={onClose}
      />
    );
  if (open.kind === "tags") return <TagManager ctl={ctl} onClose={onClose} />;
  if (open.kind === "folderForm")
    return (
      <FolderForm
        key={open.folderId ?? "new"}
        ctl={ctl}
        onClose={onClose}
        folderId={open.folderId}
        parentId={open.parentId}
      />
    );
  if (open.kind === "moveFolder")
    return <MoveFolderPicker ctl={ctl} onClose={onClose} folderId={open.folderId} />;
  if (open.kind === "folder") {
    const folder = ctl.folders.find((entry) => entry.id === open.folderId);
    if (folder === undefined) return null;
    return (
      <ActionSheet title={folder.name} actions={folderActions(ctl, folder)} onClose={onClose} />
    );
  }
  const note = ctl.notes.find((entry) => entry.id === open.noteId);
  if (note === undefined) return null;
  return <ActionSheet title={noteTitle(note)} actions={noteActions(ctl, note)} onClose={onClose} />;
}
