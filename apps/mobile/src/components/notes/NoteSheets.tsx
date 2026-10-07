/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, Icon, IconButton, Input, Text, usePalette } from "@aulora/ui-native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { archiveActionLabel, folderChildren, noteTitle } from "../../lib/notes";
import { confirm } from "../kanban/board-menus";
import { PickerSheet } from "../kanban/PickerSheet";
import { ActionSheet, BottomSheet, type SheetAction } from "../kanban/sheets";
import type { NoteFolderView, NoteListItem, NotesController } from "./use-notes";

const ROOT = "__root__";

const TAG_COLORS = [
  "#E5484D",
  "#E4571C",
  "#E8A33B",
  "#46A758",
  "#12A594",
  "#3E63DD",
  "#8E4EC6",
  "#D6409F",
  "#8B8D98",
];

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
        const id = next[0];
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

function ColorSwatch({
  color,
  selected,
  onPick,
}: {
  readonly color: string;
  readonly selected: boolean;
  readonly onPick: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`Color ${color}`}
      accessibilityState={{ checked: selected }}
      className="h-10 w-10 items-center justify-center rounded-pill active:opacity-70"
      style={{ backgroundColor: color }}
      onPress={onPick}
    >
      {selected && <Icon name="check" size={20} color={palette["on-accent"]} />}
    </Pressable>
  );
}

function TagManager({
  ctl,
  onClose,
}: {
  readonly ctl: NotesController;
  readonly onClose: () => void;
}) {
  const palette = usePalette();
  const [form, setForm] = useState<
    { id: string | undefined; name: string; color: string } | undefined
  >(undefined);
  const [busy, setBusy] = useState(false);
  const save = () => {
    if (form === undefined || !form.name.trim() || busy) return;
    setBusy(true);
    const work =
      form.id === undefined
        ? () => ctl.mutations.createTag({ name: form.name, color: form.color })
        : () =>
            ctl.mutations.updateTag({
              tagId: form.id as never,
              name: form.name,
              color: form.color,
            });
    void ctl.run(work).then((saved) => {
      setBusy(false);
      if (saved) setForm(undefined);
    });
  };
  return (
    <BottomSheet title="Tags" onClose={onClose}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}>
        {ctl.tags.length === 0 && form === undefined && (
          <Text size="sm" tone="muted" className="px-4 py-4">
            No tags yet.
          </Text>
        )}
        {ctl.tags.map((tag) => (
          <View key={tag.id} className="min-h-12 flex-row items-center gap-3 px-4 py-1">
            <View className="h-4 w-4 rounded-pill" style={{ backgroundColor: tag.color }} />
            <Text className="min-w-0 flex-1" numberOfLines={1}>
              {tag.name}
            </Text>
            {ctl.permissions.edit && (
              <IconButton
                label={`Rename ${tag.name}`}
                size="sm"
                onPress={() => {
                  setForm({ id: tag.id, name: tag.name, color: tag.color });
                }}
              >
                <Icon name="pencil" size={18} color={palette["text-muted"]} />
              </IconButton>
            )}
            {ctl.permissions.remove && (
              <IconButton
                label={`Delete ${tag.name}`}
                size="sm"
                onPress={() => {
                  confirm(
                    "Delete tag?",
                    "The tag is removed from every note. The notes themselves are kept.",
                    "Delete tag",
                    () => {
                      void ctl.run(() => ctl.mutations.deleteTag({ tagId: tag.id as never }));
                    },
                  );
                }}
              >
                <Icon name="trash" size={18} color={palette.danger} />
              </IconButton>
            )}
          </View>
        ))}
        {form !== undefined && (
          <View className="gap-3 px-4 py-3">
            <Input
              label={form.id === undefined ? "New tag name" : "Tag name"}
              autoFocus
              maxLength={32}
              returnKeyType="done"
              value={form.name}
              onChangeText={(name) => {
                setForm({ ...form, name });
              }}
              onSubmitEditing={save}
            />
            <View className="flex-row flex-wrap gap-2">
              {TAG_COLORS.map((color) => (
                <ColorSwatch
                  key={color}
                  color={color}
                  selected={form.color.toLowerCase() === color.toLowerCase()}
                  onPick={() => {
                    setForm({ ...form, color });
                  }}
                />
              ))}
            </View>
            <View className="flex-row gap-2">
              <Button loading={busy} disabled={!form.name.trim()} onPress={save}>
                {form.id === undefined ? "Create tag" : "Save tag"}
              </Button>
              <Button
                variant="ghost"
                onPress={() => {
                  setForm(undefined);
                }}
              >
                Cancel
              </Button>
            </View>
          </View>
        )}
        {form === undefined && ctl.permissions.edit && (
          <View className="px-4 py-3">
            <Button
              variant="secondary"
              className="self-start"
              onPress={() => {
                setForm({ id: undefined, name: "", color: TAG_COLORS[0] ?? "#3E63DD" });
              }}
            >
              Add tag
            </Button>
          </View>
        )}
      </ScrollView>
    </BottomSheet>
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
