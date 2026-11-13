import { notesBackAction } from "../../lib/back-navigation";
import { KeyboardAvoidingPane } from "../layout/ScreenContainer";
import { useBackPress } from "../navigation/BackPress";
import { NoteEditorScreen } from "./NoteEditorScreen";
import { NoteHistoryScreen } from "./NoteHistoryScreen";
import { NotesSheets } from "./NoteSheets";
import { NotesList } from "./NotesList";
import { useNoteEditor } from "./use-note-editor";
import { type NotesProps, useNotes } from "./use-notes";

/**
 * The Notes addon on a phone or tablet: a folder-and-note list, one note’s
 * Markdown editor and its history, with the sheets that manage them.
 */
export function NotesScreen({
  active = true,
  ...props
}: NotesProps & { readonly active?: boolean }) {
  const ctl = useNotes(props);
  const editor = useNoteEditor(ctl);
  const target = notesBackAction({ mode: ctl.mode, folderId: ctl.filters.folderId });

  // Android back unwinds Notes' own stack before the chat's history: history
  // returns to the note, the editor goes through its unsaved-changes guard,
  // and a drilled-in folder returns to the view it was opened from.
  useBackPress(active && target !== "none", () => {
    if (ctl.mode === "history") {
      ctl.backFromView();
      return true;
    }
    if (ctl.mode === "editor") {
      editor.backToList();
      return true;
    }
    if (notesBackAction({ mode: ctl.mode, folderId: ctl.filters.folderId }) === "folder") {
      ctl.goUpFolder();
      return true;
    }
    return false;
  });

  return (
    // Lifts the editor’s composer clear of the keyboard.
    <KeyboardAvoidingPane style={{ flex: 1 }}>
      {ctl.mode === "editor" ? (
        <NoteEditorScreen ctl={ctl} editor={editor} />
      ) : ctl.mode === "history" ? (
        <NoteHistoryScreen ctl={ctl} />
      ) : (
        <NotesList ctl={ctl} />
      )}
      <NotesSheets ctl={ctl} />
    </KeyboardAvoidingPane>
  );
}
