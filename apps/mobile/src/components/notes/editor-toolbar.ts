import { applyHeading, cycleHeading, type NoteEdit, toggleList, toggleWrap } from "@aulora/core";
import type { IconName } from "@aulora/tokens";

/** The formatting actions offered by the mobile editor's toolbar. */
export type NoteFormatId = "bold" | "italic" | "heading" | "bulletList" | "orderedList" | "code";

export interface NoteFormatSpec {
  readonly id: NoteFormatId;
  readonly label: string;
  readonly icon: IconName;
}

/** The toolbar's buttons, in display order. */
export const NOTE_FORMATS: readonly NoteFormatSpec[] = [
  { id: "bold", label: "Bold", icon: "bold" },
  { id: "italic", label: "Italic", icon: "italic" },
  { id: "heading", label: "Heading", icon: "heading" },
  { id: "bulletList", label: "Bullet list", icon: "list-bulleted" },
  { id: "orderedList", label: "Numbered list", icon: "list-numbered" },
  { id: "code", label: "Code", icon: "code" },
];

/**
 * Applies a toolbar action to the note body. Toggle behaviour lives in
 * `@aulora/core`, so a second tap undoes the formatting exactly as on the web.
 */
export function runNoteFormat(
  id: NoteFormatId,
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
  }
}

/** Applies an exact heading level, used by the long-press heading menu. */
export function runNoteHeading(value: string, start: number, end: number, level: number): NoteEdit {
  return applyHeading(value, start, end, level);
}
