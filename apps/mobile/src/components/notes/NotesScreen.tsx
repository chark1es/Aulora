import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { NoteEditorScreen } from "./NoteEditorScreen";
import { NoteHistoryScreen } from "./NoteHistoryScreen";
import { NotesSheets } from "./NoteSheets";
import { NotesList } from "./NotesList";
import { type NotesProps, useNotes } from "./use-notes";

/**
 * The Notes addon on a phone or tablet: a folder-and-note list, one note's
 * Markdown editor and its history, with the sheets that manage them.
 */
export function NotesScreen(props: NotesProps) {
  const ctl = useNotes(props);
  return (
    // Lifts the editor's composer clear of the keyboard.
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      {ctl.mode === "editor" ? (
        <NoteEditorScreen ctl={ctl} />
      ) : ctl.mode === "history" ? (
        <NoteHistoryScreen ctl={ctl} />
      ) : (
        <NotesList ctl={ctl} />
      )}
      <NotesSheets ctl={ctl} />
    </KeyboardAvoidingView>
  );
}
