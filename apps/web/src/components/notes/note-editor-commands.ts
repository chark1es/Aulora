import {
  applyHeading,
  continueList,
  indentLines,
  type NoteChangeKind,
  type NoteEdit,
  toggleList,
  typedChangeKind,
} from "@aulora/core";
import type { MutableRefObject } from "react";
import { useRef } from "react";
import { type EditorActionId, runEditorAction } from "./editor-actions";
import type { NoteDraft, NotesController } from "./use-notes";
import type { useUndoHistory } from "./use-undo-history";

export interface Selection {
  start: number;
  end: number;
}

type History = ReturnType<typeof useUndoHistory>;

interface CommandOptions {
  ctl: NotesController;
  current: NoteDraft;
  history: History;
  bodyRef: MutableRefObject<HTMLTextAreaElement | null>;
  /** Where to place the caret after the next render. */
  pendingSelection: MutableRefObject<[number, number] | null>;
}

/**
 * The body field's edit commands: formatting, undo/redo, and the keyboard
 * shortcuts. Kept out of the component so each piece stays small and the
 * selection bookkeeping lives in one place.
 */
export function useEditorCommands({
  ctl,
  current,
  history,
  bodyRef,
  pendingSelection,
}: CommandOptions) {
  const selectionRef = useRef<Selection>({ start: 0, end: 0 });

  const elementSelection = (): Selection => {
    const element = bodyRef.current;
    return element === null
      ? selectionRef.current
      : { start: element.selectionStart, end: element.selectionEnd };
  };

  const applyEdit = (result: NoteEdit, kind: NoteChangeKind) => {
    const selection = elementSelection();
    history.record(
      { text: current.body, start: selection.start, end: selection.end },
      kind,
      Date.now(),
    );
    pendingSelection.current = [result.start, result.end];
    ctl.setDraft({ ...current, body: result.text });
  };

  const runAction = (id: EditorActionId) => {
    const selection = elementSelection();
    applyEdit(runEditorAction(id, current.body, selection.start, selection.end), "action");
  };

  const restore = (snapshot: NoteEdit) => {
    pendingSelection.current = [snapshot.start, snapshot.end];
    ctl.setDraft({ ...current, body: snapshot.text });
  };

  const undo = () => {
    const snapshot = history.undo({ text: current.body, ...elementSelection() });
    if (snapshot !== undefined) restore(snapshot);
  };

  const redo = () => {
    const snapshot = history.redo({ text: current.body, ...elementSelection() });
    if (snapshot !== undefined) restore(snapshot);
  };

  /** Applies a Cmd/Ctrl shortcut's formatting action, when the key matches one. */
  const onFormatKey = (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!(event.metaKey || event.ctrlKey)) return false;
    const selection = elementSelection();
    const code = event.code;
    if (event.altKey && /^Digit[123]$/.test(code)) {
      const level = Number.parseInt(code.slice(5), 10);
      applyEdit(applyHeading(current.body, selection.start, selection.end, level), "action");
      return true;
    }
    if (event.shiftKey && (code === "Digit7" || code === "Digit8")) {
      applyEdit(
        toggleList(current.body, selection.start, selection.end, code === "Digit7"),
        "action",
      );
      return true;
    }
    const action = MATCH_ACTIONS[`${event.key.toLowerCase()}:${event.shiftKey ? 1 : 0}`];
    if (action === undefined) return false;
    runAction(action);
    return true;
  };

  /** Tab indents a list line; Enter continues a list; both fall through otherwise. */
  const onEditKey = (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const selection = elementSelection();
    if (event.key === "Tab") {
      applyEdit(
        indentLines(current.body, selection.start, selection.end, event.shiftKey ? -1 : 1),
        "action",
      );
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      const result = continueList(current.body, selection.start, selection.end);
      if (result === null) return false;
      applyEdit(result, "action");
      return true;
    }
    return false;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    selectionRef.current = elementSelection();
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.code === "KeyS") {
      event.preventDefault();
      if (ctl.canEdit && ctl.dirty && !ctl.busy) void ctl.saveNote();
      return;
    }
    if (mod && event.code === "KeyZ") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && event.code === "KeyY") {
      event.preventDefault();
      redo();
      return;
    }
    if (onFormatKey(event) || onEditKey(event)) event.preventDefault();
  };

  /** Records an edit from the field's own `change` event. */
  const onBodyChange = (next: string, element: HTMLTextAreaElement) => {
    history.record(
      { text: current.body, ...selectionRef.current },
      typedChangeKind(current.body, next),
      Date.now(),
    );
    selectionRef.current = { start: element.selectionStart, end: element.selectionEnd };
    ctl.setDraft({ ...current, body: next });
  };

  const trackSelection = (element: HTMLTextAreaElement) => {
    selectionRef.current = { start: element.selectionStart, end: element.selectionEnd };
  };

  return { runAction, undo, redo, onKeyDown, onBodyChange, trackSelection };
}

/** Letter keys that map straight onto a formatting action. */
const MATCH_ACTIONS: Record<string, EditorActionId | undefined> = {
  "b:0": "bold",
  "i:0": "italic",
  "k:0": "link",
  "e:0": "code",
  "c:1": "code",
};
