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

function useEditorState(note: NoteDetailView | undefined, startsEditing: boolean) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);
  const [sheet, setSheet] = useState<EditorSheet>(undefined);
  const [busy, setBusy] = useState(false);
  /**
   * Existing notes open read-only; a new note opens straight into the editor.
   * An explicit tap on the header's edit control is the only way in.
   */
  const [editing, setEditing] = useState(startsEditing);
  /** The remote revision the viewer chose to replace on their next save. */
  const [dismissedRevision, setDismissedRevision] = useState<number | undefined>(undefined);
  /** Set when a save was rejected as stale, even before the subscription catches up. */
  const [saveConflict, setSaveConflict] = useState(false);
  const [saved, setSaved] = useState(false);

  // The revision (and field snapshot) the local draft was seeded from. It only
  // advances on a clean seed or a successful save, so unsaved edits survive a
  // live subscription update.
  const seedRef = useRef<NoteDraftSeed | undefined>(undefined);
  /**
   * The fields as of the newest render. A save continuation closes over the
   * values from the render that started it, so it compares against this ref to
   * tell whether the person typed a newer draft while the write was in flight.
   */
  const latestDraftRef = useRef({ title, body, folderId, tagIds });
  latestDraftRef.current = { title, body, folderId, tagIds };
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
    keepMyVersion,
    latestDraftRef,
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
    editing,
    setEditing,
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
    latestDraftRef,
  } = state;
  /**
   * Guards the window between a tap and the next render: without it, a second
   * tap (or the menu action) can start the same write twice from one `busy`
   * snapshot and race two revisions of the same note.
   */
  const inFlight = useRef(false);
  /** The note the person is looking at now, not the one this render closed over. */
  const latestNoteId = useRef(ctl.selectedId);
  latestNoteId.current = ctl.selectedId;

  const save = () => {
    if (inFlight.current || busy || !hasNoteContent(title, body)) return;
    const noteIdAtSave = ctl.selectedId;
    inFlight.current = true;
    setBusy(true);
    void runNoteSave({
      note: note === undefined ? undefined : { id: note.id, revision: note.revision },
      baseRevision,
      fields: { title, body, folderId, tagIds },
      create: (request) => ctl.mutations.createNote(request as never),
      update: (request) => ctl.mutations.updateNote(request as never),
    })
      .then((result) => {
        inFlight.current = false;
        setBusy(false);
        // A write that lands after the person moved to another note must not
        // rebase, close or report on the note they are looking at now.
        if (latestNoteId.current !== noteIdAtSave) return;
        if (result.kind === "created") {
          ctl.openNote(result.noteId);
          return;
        }
        if (result.kind === "saved") {
          const savedSnapshot = { title, body, folderId, tagIds };
          markSaved(result.seed);
          // `markSaved` advances the clean seed without clobbering typing that
          // landed mid-write. Only leave the editor when the draft is still the
          // snapshot that was submitted; otherwise the newer text must stay in
          // an editable, visibly dirty draft instead of being shown as saved.
          if (sameDraft(latestDraftRef.current, savedSnapshot)) {
            state.setEditing(false);
          }
          ctl.setError(undefined);
          return;
        }
        if (result.kind === "conflict") showReloadPrompt();
        ctl.setError(result.message);
      })
      .catch((cause: unknown) => {
        inFlight.current = false;
        setBusy(false);
        if (latestNoteId.current === noteIdAtSave) {
          ctl.setError(failure(cause));
        }
      });
  };
  return save;
}

function sameDraft(
  a: {
    readonly title: string;
    readonly body: string;
    readonly folderId: string | null;
    readonly tagIds: readonly string[];
  },
  b: {
    readonly title: string;
    readonly body: string;
    readonly folderId: string | null;
    readonly tagIds: readonly string[];
  },
): boolean {
  return (
    a.title === b.title &&
    a.body === b.body &&
    a.folderId === b.folderId &&
    a.tagIds.length === b.tagIds.length &&
    a.tagIds.every((tagId, index) => tagId === b.tagIds[index])
  );
}

export function useNoteEditor(ctl: NotesController) {
  const state = useEditorState(ctl.detail, ctl.selectedId === null);
  const editing = useBodyEditing(state);
  const save = useNoteSave(ctl, state);
  const selectedId = ctl.selectedId;
  const setEditing = state.setEditing;
  // A different note (or a freshly created one) always starts in viewing mode.
  useEffect(() => {
    setEditing(selectedId === null);
  }, [selectedId, setEditing]);
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
    requestNoteDiscard(state.dirty, ctl.backToList, confirmDiscard);
  };
  const openHistory = (noteId: string) => {
    requestNoteDiscard(
      state.dirty,
      () => {
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
