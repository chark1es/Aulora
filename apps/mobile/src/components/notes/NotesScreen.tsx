import { useEffect, useRef } from "react";
import { BackHandler } from "react-native";
import { notesBackTarget } from "../../lib/back-navigation";
import { KeyboardAvoidingPane } from "../layout/ScreenContainer";
import { NoteEditorScreen } from "./NoteEditorScreen";
import { NoteHistoryScreen } from "./NoteHistoryScreen";
import { NotesSheets } from "./NoteSheets";
import { NotesList } from "./NotesList";
import { type NotesProps, useNotes } from "./use-notes";

/**
 * The Notes addon on a phone or tablet: a folder-and-note list, one note’s
 * Markdown editor and its history, with the sheets that manage them.
 */
export function NotesScreen(props: NotesProps) {
  const ctl = useNotes(props);
  // The controller's callbacks are recreated on every render; keep the latest
  // one behind a ref so the back listener only re-registers when the nested
  // view actually changes.
  const latest = useRef(ctl);
  latest.current = ctl;
  const mode = ctl.mode;
  const folderId = ctl.filters.folderId;

  // Notes keeps its editor, history and folder drill-in inside this tab. Android
  // back has to unwind those nested views before the chat's hub tab changes;
  // the sheets above them handle their own dismissal.
  useEffect(() => {
    if (notesBackTarget({ mode, folderId }) === "none") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (latest.current.mode !== "list") {
        latest.current.backToList();
      } else if (latest.current.filters.folderId !== undefined) {
        latest.current.goUpFolder();
      }
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, [mode, folderId]);

  return (
    // Lifts the editor’s composer clear of the keyboard.
    <KeyboardAvoidingPane style={{ flex: 1 }}>
      {ctl.mode === "editor" ? (
        <NoteEditorScreen ctl={ctl} />
      ) : ctl.mode === "history" ? (
        <NoteHistoryScreen ctl={ctl} />
      ) : (
        <NotesList ctl={ctl} />
      )}
      <NotesSheets ctl={ctl} />
    </KeyboardAvoidingPane>
  );
}
