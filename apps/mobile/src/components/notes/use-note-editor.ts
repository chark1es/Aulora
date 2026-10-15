import { useEffect, useRef, useState } from "react";
import { hasNoteContent } from "../../lib/notes";
import type { NoteDetailView, NotesController } from "./use-notes";

export type EditorSheet = "menu" | "tags" | "folder" | undefined;

function useEditorState(note?: NoteDetailView) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);
  const [sheet, setSheet] = useState<EditorSheet>(undefined);
  const [busy, setBusy] = useState(false);

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

  return {
    title,
    setTitle,
    body,
    setBody,
    folderId,
    setFolderId,
    tagIds,
    setTagIds,
    preview,
    setPreview,
    sheet,
    setSheet,
    busy,
    setBusy,
  };
}

type EditorState = ReturnType<typeof useEditorState>;

function useNoteSave(ctl: NotesController, state: EditorState) {
  const note = ctl.detail;
  const { title, body, folderId, tagIds, busy, setBusy } = state;
  const createdRef = useRef<string | undefined>(undefined);
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
  return save;
}

export function useNoteEditor(ctl: NotesController) {
  const state = useEditorState(ctl.detail);
  const save = useNoteSave(ctl, state);
  return { ...state, save };
}

export type NoteEditorController = ReturnType<typeof useNoteEditor>;
