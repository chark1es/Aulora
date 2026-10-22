/**
 * The web note editor's toolbar actions: each one maps an id onto the pure
 * transform in `@aulora/core`, together with the keyboard shortcut shown in its
 * tooltip. Kept free of React so the mapping is unit-testable on its own.
 */

import {
  applyHeading,
  cycleHeading,
  insertLink,
  type NoteEdit,
  toggleList,
  toggleWrap,
} from "@aulora/core";
import { isApplePlatform, shortcutLabel } from "../../lib/shortcuts";

export type EditorActionId =
  | "bold"
  | "italic"
  | "heading"
  | "bulletList"
  | "orderedList"
  | "code"
  | "link";

export interface EditorActionSpec {
  readonly id: EditorActionId;
  readonly label: string;
  /** Modifier parts fed to `formatShortcut`, e.g. `["Mod", "B"]`. */
  readonly shortcut: readonly string[];
  /** The icon drawn on the button. */
  readonly icon:
    | "bold"
    | "italic"
    | "heading"
    | "list-bulleted"
    | "list-numbered"
    | "code"
    | "link";
}

/** A button that only needs a label and shortcut, e.g. Undo/Redo. */
export interface ShortcutSpec {
  readonly label: string;
  readonly shortcut: readonly string[];
}

/** The formatting buttons, in toolbar order. */
export const EDITOR_ACTIONS: readonly EditorActionSpec[] = [
  { id: "bold", label: "Bold", shortcut: ["Mod", "B"], icon: "bold" },
  { id: "italic", label: "Italic", shortcut: ["Mod", "I"], icon: "italic" },
  { id: "heading", label: "Heading", shortcut: ["Mod", "Alt", "1"], icon: "heading" },
  {
    id: "bulletList",
    label: "Bullet list",
    shortcut: ["Mod", "Shift", "8"],
    icon: "list-bulleted",
  },
  {
    id: "orderedList",
    label: "Numbered list",
    shortcut: ["Mod", "Shift", "7"],
    icon: "list-numbered",
  },
  { id: "code", label: "Code", shortcut: ["Mod", "E"], icon: "code" },
  { id: "link", label: "Link", shortcut: ["Mod", "K"], icon: "link" },
];

/** Applies a toolbar action to the document and selection. */
export function runEditorAction(
  id: EditorActionId,
  value: string,
  start: number,
  end: number,
): NoteEdit {
  switch (id) {
    case "bold":
      return toggleWrap(value, start, end, "bold");
    case "italic":
      return toggleWrap(value, start, end, "italic");
    case "code":
      return toggleWrap(value, start, end, "code");
    case "bulletList":
      return toggleList(value, start, end, false);
    case "orderedList":
      return toggleList(value, start, end, true);
    case "heading":
      return cycleHeading(value, start, end);
    case "link":
      return insertLink(value, start, end);
  }
}

/** Applies a heading at an exact level, for Cmd/Ctrl+Alt+1..3. */
export function runHeading(value: string, start: number, end: number, level: number): NoteEdit {
  return applyHeading(value, start, end, level);
}

/** The tooltip/aria label for a toolbar button, with its shortcut appended. */
export function actionLabel(spec: ShortcutSpec, apple: boolean = isApplePlatform()): string {
  return `${spec.label} (${shortcutLabel(spec.shortcut, apple)})`;
}

/**
 * Whether the platform uses the Command key. Kept as the editor's name for
 * `isApplePlatform` so the toolbar and its tests read the same.
 */
export function detectMac(): boolean {
  return isApplePlatform();
}
