import { Button, Icon, IconButton, usePalette } from "@aulora/ui-native";
import { ScrollView, View } from "react-native";
import { hasNoteContent, noteTitle } from "../../lib/notes";
import { PaneHeader } from "../chat/HubPane";
import { ActionSheet } from "../kanban/sheets";
import {
  NoteBodyInput,
  NoteEditorPickers,
  NoteProperties,
  NoteTitleInput,
} from "./NoteEditorParts";
import { NoteBackButton, NotesError, NotesLoading } from "./NoteParts";
import { editorActions } from "./note-editor-actions";
import { useNoteEditor } from "./use-note-editor";
import type { NotesController } from "./use-notes";

function NoteEditorHeader({
  ctl,
  onMenu,
}: {
  readonly ctl: NotesController;
  readonly onMenu: () => void;
}) {
  const palette = usePalette();
  const note = ctl.detail;
  return (
    <PaneHeader
      title={note === undefined ? "New note" : noteTitle(note)}
      subtitle={note?.archived === true ? "Archived" : undefined}
      leading={<NoteBackButton onPress={ctl.backToList} />}
      trailing={
        <IconButton label="Note actions" size="sm" onPress={onMenu}>
          <Icon name="more-horizontal" size={20} color={palette.text} />
        </IconButton>
      }
    />
  );
}

/** Writes one note: a Markdown field with a preview, tags and a folder. */
export function NoteEditorScreen({ ctl }: { readonly ctl: NotesController }) {
  const editor = useNoteEditor(ctl);
  const { title, body, busy, sheet, setSheet, save } = editor;
  const isNew = ctl.selectedId === null;
  const note = ctl.detail;
  if (!isNew && note === undefined) return <NotesLoading label="Loading note" />;
  return (
    <View className="flex-1">
      <NoteEditorHeader
        ctl={ctl}
        onMenu={() => {
          setSheet("menu");
        }}
      />
      <NotesError ctl={ctl} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }}>
        <NoteTitleInput editor={editor} />
        <NoteBodyInput editor={editor} />
        <NoteProperties ctl={ctl} editor={editor} />
      </ScrollView>
      <View className="border-t border-border px-4 py-3">
        <Button loading={busy} disabled={!hasNoteContent(title, body)} onPress={save}>
          {isNew ? "Create note" : "Save note"}
        </Button>
      </View>
      {sheet === "menu" && (
        <ActionSheet
          title={note === undefined ? "New note" : noteTitle(note)}
          actions={editorActions(ctl, editor)}
          onClose={() => {
            setSheet(undefined);
          }}
        />
      )}
      <NoteEditorPickers ctl={ctl} editor={editor} />
    </View>
  );
}
