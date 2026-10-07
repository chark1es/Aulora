/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, Icon, IconButton, Text, usePalette } from "@aulora/ui-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { archiveActionLabel, hasNoteContent, noteTitle, tagsForIds } from "../../lib/notes";
import { PaneHeader } from "../chat/HubPane";
import { confirm } from "../kanban/board-menus";
import { PickerSheet } from "../kanban/PickerSheet";
import { PropertyRow } from "../kanban/parts";
import { ActionSheet, type SheetAction } from "../kanban/sheets";
import { NoteBackButton, NotesError, NotesLoading, NoteTagChip } from "./NoteParts";
import { NotePreview } from "./NotePreview";
import type { NotesController } from "./use-notes";

const NO_FOLDER = "__unfiled__";
type EditorSheet = "menu" | "tags" | "folder" | undefined;

function Segment({
  label,
  active,
  onPress,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={`min-h-9 flex-1 items-center justify-center rounded-[7px] ${
        active ? "bg-surface-3" : ""
      }`}
    >
      <Text
        size="sm"
        className="font-medium"
        style={{ color: active ? palette.text : palette["text-muted"] }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Writes one note: a Markdown field with a preview, tags and a folder. */
export function NoteEditorScreen({ ctl }: { readonly ctl: NotesController }) {
  const palette = usePalette();
  const isNew = ctl.selectedId === null;
  const note = ctl.detail;
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);
  const [sheet, setSheet] = useState<EditorSheet>(undefined);
  const [busy, setBusy] = useState(false);
  const createdRef = useRef<string | undefined>(undefined);
  const seededRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (note === undefined) return;
    const key = `${note.id}:${note.revision}`;
    if (seededRef.current === key) return;
    seededRef.current = key;
    setTitle(note.title);
    setBody(note.body);
    setFolderId(note.folderId);
    setTagIds([...note.tagIds]);
  }, [note]);

  const canEdit = ctl.permissions.edit;
  const selectedTags = tagsForIds(ctl.tags, tagIds);

  const save = () => {
    if (busy || !hasNoteContent(title, body)) return;
    setBusy(true);
    createdRef.current = undefined;
    void ctl
      .run(async () => {
        const args = {
          title: title.trim(),
          body,
          tagIds: tagIds as never,
          ...(folderId !== null ? { folderId: folderId as never } : {}),
        };
        if (note === undefined) {
          createdRef.current = await ctl.mutations.createNote(args);
        } else {
          await ctl.mutations.updateNote({ noteId: note.id, revision: note.revision, ...args });
        }
      })
      .then((saved) => {
        setBusy(false);
        const id = createdRef.current;
        if (saved && id !== undefined) ctl.openNote(id);
      });
  };

  const toggleArchive = () => {
    if (note === undefined) return;
    void ctl.run(() => ctl.mutations.archiveNote({ noteId: note.id, archived: !note.archived }));
  };

  const remove = () => {
    if (note === undefined) return;
    const noteId = note.id;
    confirm(
      "Permanently delete note?",
      "This deletes the note and its history. It cannot be undone.",
      "Delete note",
      () => {
        void ctl
          .run(() => ctl.mutations.deleteNote({ noteId }))
          .then((deleted) => {
            if (deleted) ctl.closeNote();
          });
      },
    );
  };

  if (!isNew && note === undefined) return <NotesLoading label="Loading note" />;

  const actions: SheetAction[] = [
    {
      id: "save",
      label: isNew ? "Create note" : "Save note",
      icon: "check",
      disabled: !hasNoteContent(title, body),
      onPress: save,
    },
  ];
  if (note !== undefined) {
    actions.push({
      id: "history",
      label: "View history…",
      icon: "history",
      section: true,
      onPress: () => {
        ctl.openHistory(note.id);
      },
    });
    if (canEdit)
      actions.push({
        id: "archive",
        label: archiveActionLabel(note.archived),
        icon: note.archived ? "unarchive" : "archive",
        onPress: toggleArchive,
      });
    if (ctl.permissions.remove)
      actions.push({
        id: "delete",
        label: "Delete note…",
        icon: "trash",
        danger: true,
        onPress: remove,
      });
  }

  return (
    <View className="flex-1">
      <PaneHeader
        title={note === undefined ? "New note" : noteTitle(note)}
        subtitle={note?.archived === true ? "Archived" : undefined}
        leading={<NoteBackButton onPress={ctl.backToList} />}
        trailing={
          <IconButton
            label="Note actions"
            size="sm"
            onPress={() => {
              setSheet("menu");
            }}
          >
            <Icon name="more-horizontal" size={20} color={palette.text} />
          </IconButton>
        }
      />
      <NotesError ctl={ctl} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }}>
        <TextInput
          accessibilityLabel="Note title"
          placeholder="Title"
          placeholderTextColor={palette["text-muted"]}
          value={title}
          onChangeText={setTitle}
          maxLength={200}
          className="mx-4 mb-2 min-h-12 rounded-input border border-border bg-surface-1 px-3 text-[20px] font-semibold text-text"
        />
        <View className="mx-4 mb-2 flex-row rounded-input border border-border bg-surface-2 p-0.5">
          <Segment
            label="Write"
            active={!preview}
            onPress={() => {
              setPreview(false);
            }}
          />
          <Segment
            label="Preview"
            active={preview}
            onPress={() => {
              setPreview(true);
            }}
          />
        </View>
        {preview ? (
          <View className="mx-4 rounded-input border border-border bg-surface-1 p-3">
            <NotePreview body={body} />
          </View>
        ) : (
          <TextInput
            accessibilityLabel="Note body"
            placeholder="Write in Markdown…"
            placeholderTextColor={palette["text-muted"]}
            value={body}
            onChangeText={setBody}
            multiline
            textAlignVertical="top"
            className="mx-4 min-h-[220px] rounded-input border border-border bg-surface-1 p-3 text-[16px] text-text"
            style={{ lineHeight: 22 }}
          />
        )}
        <View className="mx-4 mt-3 overflow-hidden rounded-input border border-border">
          <PropertyRow
            icon="grid"
            label="Folder"
            {...(canEdit
              ? {
                  onPress: () => {
                    setSheet("folder");
                  },
                }
              : {})}
          >
            <Text size="sm" numberOfLines={1}>
              {folderId === null
                ? "Unfiled"
                : (ctl.folders.find((f) => f.id === folderId)?.name ?? "Folder")}
            </Text>
          </PropertyRow>
          <PropertyRow
            icon="label"
            label="Tags"
            last
            {...(canEdit
              ? {
                  onPress: () => {
                    setSheet("tags");
                  },
                }
              : {})}
          >
            {selectedTags.length === 0 ? (
              <Text size="sm" tone="muted">
                None
              </Text>
            ) : (
              selectedTags.slice(0, 2).map((tag) => <NoteTagChip key={tag.id} tag={tag} />)
            )}
          </PropertyRow>
        </View>
      </ScrollView>
      <View className="border-t border-border px-4 py-3">
        <Button loading={busy} disabled={!hasNoteContent(title, body)} onPress={save}>
          {isNew ? "Create note" : "Save note"}
        </Button>
      </View>

      {sheet === "menu" && (
        <ActionSheet
          title={note === undefined ? "New note" : noteTitle(note)}
          actions={actions}
          onClose={() => {
            setSheet(undefined);
          }}
        />
      )}
      {sheet === "folder" && (
        <PickerSheet
          title="Move to folder"
          options={[
            { id: NO_FOLDER, label: "Unfiled" },
            ...ctl.flatFolders.map((entry) => ({
              id: entry.folder.id,
              label: `${"  ".repeat(entry.depth)}${entry.folder.name}`,
            })),
          ]}
          selected={[folderId ?? NO_FOLDER]}
          onChange={(next) => {
            const id = next[0];
            setFolderId(id === undefined || id === NO_FOLDER ? null : id);
            setSheet(undefined);
          }}
          onClose={() => {
            setSheet(undefined);
          }}
        />
      )}
      {sheet === "tags" && (
        <PickerSheet
          multiple
          title="Tags"
          emptyText="No tags yet. Create one from the list's More menu."
          options={ctl.tags.map((tag) => ({
            id: tag.id,
            label: tag.name,
            leading: (
              <View className="h-3 w-3 rounded-pill" style={{ backgroundColor: tag.color }} />
            ),
          }))}
          selected={tagIds}
          onChange={setTagIds}
          onClose={() => {
            setSheet(undefined);
          }}
        />
      )}
    </View>
  );
}
