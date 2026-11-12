import { NoteEditHistory, typedChangeKind } from "@aulora/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { failure } from "../../lib/kanban";
import {
  decideNoteSeed,
  type NoteDraftSeed,
  noteDraftDirty,
  noteNeedsReload,
  rebaseNoteDraft,
  requestNoteDiscard,
  runNoteSave,
} from "../../lib/note-draft";
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
  /** The remote revision the viewer chose to replace on their next save. */
  const [dismissedRevision, setDismissedRevision] = useState<number | undefined>(undefined);
  /** Set when a save was rejected as stale, even before the subscription catches up. */
  const [saveConflict, setSaveConflict] = useState(false);
  const [saved, setSaved] = useState(false);

  // The revision (and field snapshot) the local draft was seeded from. It only
  // advances on a clean seed or a successful save, so unsaved edits survive a
  // live subscription update.
  const seedRef = useRef<NoteDraftSeed | undefined>(undefined);
  const dirty = noteDraftDirty({ seed: seedRef.current, title, body, folderId, tagIds });
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const applySeed = useCallback((next: NoteDraftSeed) => {
    seedRef.current = next;
    setSaved(false);
    setTitle(next.title);
    setBody(next.body);
    setFolderId(next.folderId);
    setTagIds([...next.tagIds]);
  }, []);

  useEffect(() => {
    if (note === undefined) return;
    const decision = decideNoteSeed(
      seedRef.current,
      { noteId: note.id, revision: note.revision },
      dirtyRef.current,
    );
    if (decision !== "seed") return;
    applySeed({
      noteId: note.id,
      revision: note.revision,
      title: note.title,
      body: note.body,
      folderId: note.folderId,
      tagIds: [...note.tagIds],
    });
    setSaveConflict(false);
    setDismissedRevision(undefined);
  }, [note, applySeed]);

  /** Records the revision a successful save produced, so the draft is clean again. */
  const markSaved = useCallback((saved: NoteDraftSeed) => {
    seedRef.current = { ...saved, tagIds: [...saved.tagIds] };
    setSaved(true);
    setDismissedRevision(undefined);
    setSaveConflict(false);
    // Saving trims the title; show the server's value so trailing whitespace
    // cannot leave the field permanently "dirty". Do not clobber a newer edit
    // made while the save was in flight.
    setTitle((current) => (current.trim() === saved.title ? saved.title : current));
  }, []);

  /**
   * Drops the local draft after a confirmed discard. The editor hook stays
   * mounted while the list is showing, so merely changing the notes mode left
   * the discarded title/body/tags in state and they reappeared when the same
   * note was reopened. Reset to the subscribed revision (or to an empty new
   * note when no detail is loaded yet); the seed effect then starts clean.
   */
  const discardDraft = useCallback(() => {
    if (note !== undefined) {
      applySeed({
        noteId: note.id,
        revision: note.revision,
        title: note.title,
        body: note.body,
        folderId: note.folderId,
        tagIds: [...note.tagIds],
      });
    } else {
      seedRef.current = undefined;
      setSaved(false);
      setTitle("");
      setBody("");
      setFolderId(null);
      setTagIds([]);
    }
    setDismissedRevision(undefined);
    setSaveConflict(false);
  }, [note, applySeed]);

  /** Replaces local edits with the latest subscribed revision. */
  const reloadLatest = useCallback(() => {
    if (note === undefined) return;
    applySeed({
      noteId: note.id,
      revision: note.revision,
      title: note.title,
      body: note.body,
      folderId: note.folderId,
      tagIds: [...note.tagIds],
    });
    setDismissedRevision(undefined);
    setSaveConflict(false);
  }, [note, applySeed]);

  /** Explicit permission to save the local draft over the latest remote version. */
  const keepMyVersion = useCallback(() => {
    if (note === undefined) return;
    const rebased = rebaseNoteDraft(
      { seed: seedRef.current, title, body, folderId, tagIds },
      {
        noteId: note.id,
        revision: note.revision,
        title: note.title,
        body: note.body,
        folderId: note.folderId,
        tagIds: note.tagIds,
      },
    );
    seedRef.current = rebased.seed;
    setDismissedRevision(note.revision);
    setSaveConflict(false);
  }, [note, title, body, folderId, tagIds]);

  /** Re-opens the reload banner, e.g. after a save was rejected as stale. */
  const showReloadPrompt = useCallback(() => {
    setSaveConflict(true);
  }, []);

  const seed = seedRef.current;
  const needsReload = noteNeedsReload(
    seed,
    note === undefined ? undefined : { noteId: note.id, revision: note.revision },
  );
  return {
    // Identifies the revision the draft is based on; undo history resets only
    // when that base changes, not when a remote revision arrives mid-edit.
    draftKey: seed === undefined ? "new:0" : `${seed.noteId}:${seed.revision}`,
    baseRevision: seed?.revision,
    markSaved,
    needsReload,
    reloadPrompt:
      saveConflict || (needsReload && (note === undefined || dismissedRevision !== note.revision)),
    replacingNewerVersion: dismissedRevision !== undefined,
    saved,
    reloadLatest,
    discardDraft,
    keepMyVersion,
    dirty,
    showReloadPrompt,
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
function useBodyEditing(state: EditorState) {
  const history = useMemo(() => new NoteEditHistory(), []);
  const selectionRef = useRef<NoteSelection>({ start: 0, end: 0 });
  const [forced, setForced] = useState<NoteSelection | undefined>(undefined);
  const [counts, setCounts] = useState({ undo: false, redo: false });
  const keyRef = useRef("");

  const noteKey = state.draftKey;
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
  const {
    title,
    body,
    folderId,
    tagIds,
    busy,
    setBusy,
    baseRevision,
    markSaved,
    showReloadPrompt,
  } = state;
  const save = () => {
    if (busy || !hasNoteContent(title, body)) return;
    setBusy(true);
    void runNoteSave({
      note: note === undefined ? undefined : { id: note.id, revision: note.revision },
      baseRevision,
      fields: { title, body, folderId, tagIds },
      create: (request) => ctl.mutations.createNote(request as never),
      update: (request) => ctl.mutations.updateNote(request as never),
    })
      .then((result) => {
        setBusy(false);
        if (result.kind === "created") {
          ctl.openNote(result.noteId);
          return;
        }
        if (result.kind === "saved") {
          markSaved(result.seed);
          ctl.setError(undefined);
          return;
        }
        if (result.kind === "conflict") showReloadPrompt();
        ctl.setError(result.message);
      })
      .catch((cause: unknown) => {
        setBusy(false);
        ctl.setError(failure(cause));
      });
  };
  return save;
}

export function useNoteEditor(ctl: NotesController) {
  const state = useEditorState(ctl.detail);
  const editing = useBodyEditing(state);
  const save = useNoteSave(ctl, state);
  const confirmDiscard = (discard: () => void) => {
    Alert.alert("Discard unsaved changes?", "Your local changes will be lost.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard changes", style: "destructive", onPress: discard },
    ]);
  };
  const reloadLatest = () => {
    requestNoteDiscard(
      state.dirty,
      () => {
        state.reloadLatest();
        ctl.setError(undefined);
      },
      confirmDiscard,
    );
  };
  const backToList = () => {
    requestNoteDiscard(
      state.dirty,
      () => {
        state.discardDraft();
        ctl.backToList();
      },
      confirmDiscard,
    );
  };
  const openHistory = (noteId: string) => {
    requestNoteDiscard(
      state.dirty,
      () => {
        state.discardDraft();
        ctl.openHistory(noteId);
      },
      confirmDiscard,
    );
  };
  const keepMyVersion = () => {
    state.keepMyVersion();
    ctl.setError(undefined);
  };
  return {
    ...state,
    ...editing,
    save,
    reloadLatest,
    backToList,
    openHistory,
    keepMyVersion,
  };
}

export type NoteEditorController = ReturnType<typeof useNoteEditor>;
