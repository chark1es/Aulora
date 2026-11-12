import { Button, Icon, IconButton, Text, usePalette } from "@aulora/ui-native";
import { ScrollView, View } from "react-native";
import { impactFeedback } from "../../lib/haptics";
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
import type { NoteEditorController } from "./use-note-editor";
import type { NotesController } from "./use-notes";

function NoteEditorHeader({
  ctl,
  onMenu,
  onBack,
}: {
  readonly ctl: NotesController;
  readonly onMenu: () => void;
  readonly onBack: () => void;
}) {
  const palette = usePalette();
  const note = ctl.detail;
  return (
    <PaneHeader
      title={note === undefined ? "New note" : noteTitle(note)}
      subtitle={note?.archived === true ? "Archived" : undefined}
      leading={<NoteBackButton onPress={onBack} />}
      trailing={
        <IconButton label="Note actions" size="sm" onPress={onMenu}>
          <Icon name="more-horizontal" size={20} color={palette.text} />
        </IconButton>
      }
    />
  );
}

/** Offers a way out when the note changed under a draft; editing stays possible. */
function NoteReloadBanner({ editor }: { readonly editor: NoteEditorController }) {
  if (!editor.reloadPrompt && !editor.replacingNewerVersion) return null;
  if (!editor.reloadPrompt) {
    return (
      <View accessibilityRole="alert" className="border-b border-border bg-surface-2 px-4 py-3">
        <Text size="sm">Saving will replace the newer version</Text>
      </View>
    );
  }
  return (
    <View accessibilityRole="alert" className="gap-2 border-b border-border bg-surface-2 px-4 py-3">
      <Text size="sm">
        This note changed elsewhere. Reload to discard your edits, or keep your version and save it
        over the latest version.
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Button size="sm" onPress={editor.reloadLatest}>
          Reload latest
        </Button>
        <Button size="sm" variant="secondary" onPress={editor.keepMyVersion}>
          Keep my version
        </Button>
      </View>
    </View>
  );
}

/** Writes one note: a Markdown field with a preview, tags and a folder. */
export function NoteEditorScreen({
  ctl,
  editor,
}: {
  readonly ctl: NotesController;
  readonly editor: NoteEditorController;
}) {
  const { title, body, busy, sheet, setSheet, save } = editor;
  const isNew = ctl.selectedId === null;
  const note = ctl.detail;
  if (!isNew && note === undefined) return <NotesLoading label="Loading note" />;
  return (
    <View className="flex-1 min-w-0">
      <NoteEditorHeader
        ctl={ctl}
        onBack={editor.backToList}
        onMenu={() => {
          setSheet("menu");
        }}
      />
      <NotesError ctl={ctl} />
      <NoteReloadBanner editor={editor} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }}>
        <NoteTitleInput editor={editor} />
        <NoteBodyInput editor={editor} />
        <NoteProperties ctl={ctl} editor={editor} />
      </ScrollView>
      <View className="gap-2 border-t border-border px-4 py-3">
        {!editor.dirty && (
          <Text size="xs" tone="muted">
            {editor.saved ? "Saved · No changes" : "No changes"}
          </Text>
        )}
        <Button
          loading={busy}
          disabled={!editor.dirty || !hasNoteContent(title, body)}
          onPress={() => {
            impactFeedback();
            save();
          }}
        >
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
