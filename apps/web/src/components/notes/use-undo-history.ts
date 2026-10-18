import { type NoteChangeKind, NoteEditHistory, type NoteEditSnapshot } from "@aulora/core";
import { useCallback, useMemo, useRef, useState } from "react";

/**
 * Undo/redo for a controlled note body. React owns the textarea's value, so the
 * browser's native history is unreliable; this keeps its own stack of snapshots
 * (coalescing rapid typing into one step) and lives entirely inside the editor.
 * Switching notes resets the stack, so history never crosses notes.
 */
export function useUndoHistory(noteKey: string) {
  const history = useMemo(() => new NoteEditHistory(), []);
  const [state, setState] = useState({ key: noteKey, canUndo: false, canRedo: false });
  const keyRef = useRef(noteKey);
  if (keyRef.current !== noteKey) {
    keyRef.current = noteKey;
    history.reset();
  }
  const sync = useCallback(() => {
    setState({
      key: keyRef.current,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    });
  }, [history]);

  const record = useCallback(
    (previous: NoteEditSnapshot, kind: NoteChangeKind, now: number) => {
      history.record(previous, kind, now);
      sync();
    },
    [history, sync],
  );

  const undo = useCallback(
    (current: NoteEditSnapshot) => {
      const snapshot = history.undo(current);
      sync();
      return snapshot;
    },
    [history, sync],
  );

  const redo = useCallback(
    (current: NoteEditSnapshot) => {
      const snapshot = history.redo(current);
      sync();
      return snapshot;
    },
    [history, sync],
  );

  const current = state.key === noteKey ? state : { canUndo: false, canRedo: false };
  return { canUndo: current.canUndo, canRedo: current.canRedo, record, undo, redo };
}
