import { NoteEditHistory, typedChangeKind } from "@aulora/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasNoteContent } from "../../lib/notes";
import { type NoteFormatId, runNoteFormat } from "./editor-toolbar";
import type { NoteDetailView, NotesController } from "./use-notes";

export type EditorSheet = "menu" | "tags" | "folder" | undefined;

/** Where the caret or selection sits in the body field. */
export interface NoteSelection {
  readonly start: number;
  readonly end: number;
}

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

/**
 * Undo/redo plus formatting for the note body. Typing is recorded here (rather
 * than in the render body), the selection is tracked in a ref so a toolbar tap
 * acts on it, and a new note key resets the history. Only a programmatic edit
 * forces a caret position; ordinary typing leaves the field's own caret alone.
 */
function useBodyEditing(state: EditorState, note?: NoteDetailView) {
  const history = useMemo(() => new NoteEditHistory(), []);
  const selectionRef = useRef<NoteSelection>({ start: 0, end: 0 });
  const [forced, setForced] = useState<NoteSelection | undefined>(undefined);
  const [counts, setCounts] = useState({ undo: false, redo: false });
  const keyRef = useRef("");

  const noteKey = `${note?.id ?? "new"}:${note?.revision ?? 0}`;
  if (keyRef.current !== noteKey) {
    keyRef.current = noteKey;
    history.reset();
    selectionRef.current = { start: 0, end: 0 };
    if (forced !== undefined) setForced(undefined);
    if (counts.undo || counts.redo) setCounts({ undo: false, redo: false });
  }

  const sync = useCallback(() => {
    setCounts((previous) => {
      const undo = history.canUndo;
      const redo = history.canRedo;
      return previous.undo === undo && previous.redo === redo ? previous : { undo, redo };
    });
  }, [history]);

  /** A programmatic edit: move the caret/selection where the transform asked. */
  const place = useCallback((next: NoteSelection) => {
    selectionRef.current = next;
    setForced(next);
  }, []);

  const changeBody = useCallback(
    (next: string) => {
      const previous = state.body;
      if (previous !== next) {
        history.record(
          { text: previous, start: selectionRef.current.start, end: selectionRef.current.end },
          typedChangeKind(previous, next),
          Date.now(),
        );
        sync();
      }
      state.setBody(next);
    },
    [history, state, sync],
  );

  const apply = useCallback(
    (next: { text: string; start: number; end: number }) => {
      history.record(
        { text: state.body, start: selectionRef.current.start, end: selectionRef.current.end },
        "action",
        Date.now(),
      );
      sync();
      place({ start: next.start, end: next.end });
      state.setBody(next.text);
    },
    [history, place, state, sync],
  );

  const format = useCallback(
    (id: NoteFormatId) => {
      const { start, end } = selectionRef.current;
      apply(runNoteFormat(id, state.body, start, end));
    },
    [apply, state.body],
  );

  const step = useCallback(
    (direction: "undo" | "redo") => {
      const current = {
        text: state.body,
        start: selectionRef.current.start,
        end: selectionRef.current.end,
      };
      const snapshot = direction === "undo" ? history.undo(current) : history.redo(current);
      if (snapshot === undefined) return;
      sync();
      place({ start: snapshot.start, end: snapshot.end });
      state.setBody(snapshot.text);
    },
    [history, place, state, sync],
  );

  const undo = useCallback(() => {
    step("undo");
  }, [step]);
  const redo = useCallback(() => {
    step("redo");
  }, [step]);

  const setSelection = useCallback((next: NoteSelection) => {
    selectionRef.current = next;
    // The user moved the caret, so it is no longer programmatically pinned.
    setForced(undefined);
  }, []);

  return {
    selection: forced,
    setSelection,
    canUndo: counts.undo,
    canRedo: counts.redo,
    setBody: changeBody,
    format,
    undo,
    redo,
  };
}

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
  const editing = useBodyEditing(state, ctl.detail);
  const save = useNoteSave(ctl, state);
  return { ...state, ...editing, save };
}

export type NoteEditorController = ReturnType<typeof useNoteEditor>;
