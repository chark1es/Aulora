import { archiveActionLabel, hasNoteContent } from "../../lib/notes";
import { confirm } from "../kanban/board-menus";
import type { SheetAction } from "../kanban/sheets";
import type { NoteEditorController } from "./use-note-editor";
import type { NotesController } from "./use-notes";

function deleteEditorNote(ctl: NotesController) {
  const note = ctl.detail;
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
}

function savedNoteActions(ctl: NotesController): SheetAction[] {
  const note = ctl.detail;
  if (note === undefined) return [];
  const actions: SheetAction[] = [
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
        deleteEditorNote(ctl);
      },
    });
  return actions;
}

export function editorActions(ctl: NotesController, editor: NoteEditorController): SheetAction[] {
  return [
    {
      id: "save",
      label: ctl.selectedId === null ? "Create note" : "Save note",
      icon: "check",
      disabled: !hasNoteContent(editor.title, editor.body),
      onPress: editor.save,
    },
    ...savedNoteActions(ctl),
  ];
}
