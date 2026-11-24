import type { TranscriptSummary } from "@aulora/core";

export const SUMMARY_EDIT_MAX_ITEMS = 30;
export const SUMMARY_EDIT_MAX_ITEM_CHARS = 600;
export const SUMMARY_EDIT_MAX_NAME_CHARS = 80;
export const SUMMARY_EDIT_MAX_OVERVIEW_CHARS = 2_400;

/** The editable shape the `updateSummary` mutation takes. */
export interface SummaryEdit {
  readonly overview: string;
  readonly keyPoints: string[];
  readonly decisions: string[];
  readonly actionItems: { text: string; owner: string | null }[];
  readonly speakerHighlights: { speaker: string; text: string }[];
}

/** The editable fields of a parsed summary (the title and language are kept server-side). */
export function summaryToEdit(summary: TranscriptSummary): SummaryEdit {
  return {
    overview: summary.overview,
    keyPoints: [...summary.keyPoints],
    decisions: [...summary.decisions],
    actionItems: summary.actionItems.map((item) => ({ text: item.text, owner: item.owner })),
    speakerHighlights: summary.speakerHighlights.map((item) => ({ ...item })),
  };
}

/** Trims every field, drops blank rows and turns a blank owner into null. */
export function cleanSummaryEdit(draft: SummaryEdit): SummaryEdit {
  const keep = (items: readonly string[]) =>
    items.map((item) => item.trim()).filter((item) => item.length > 0);
  return {
    overview: draft.overview.trim(),
    keyPoints: keep(draft.keyPoints),
    decisions: keep(draft.decisions),
    actionItems: draft.actionItems
      .map((item) => {
        const owner = item.owner?.trim() ?? "";
        return { text: item.text.trim(), owner: owner.length > 0 ? owner : null };
      })
      .filter((item) => item.text.length > 0),
    speakerHighlights: draft.speakerHighlights
      .map((item) => ({ speaker: item.speaker.trim(), text: item.text.trim() }))
      .filter((item) => item.text.length > 0 || item.speaker.length > 0),
  };
}

/**
 * The first problem that would make the server reject this draft, as a
 * user-facing sentence, or null. The server enforces the same limits.
 */
export function validateSummaryEdit(draft: SummaryEdit): string | null {
  const cleaned = cleanSummaryEdit(draft);
  if (cleaned.overview.length > SUMMARY_EDIT_MAX_OVERVIEW_CHARS) {
    return `The overview is over ${SUMMARY_EDIT_MAX_OVERVIEW_CHARS} characters.`;
  }
  const lists: [string, number][] = [
    ["Key points", cleaned.keyPoints.length],
    ["Decisions", cleaned.decisions.length],
    ["Action items", cleaned.actionItems.length],
    ["Speaker highlights", cleaned.speakerHighlights.length],
  ];
  for (const [name, count] of lists) {
    if (count > SUMMARY_EDIT_MAX_ITEMS) {
      return `${name} can have at most ${SUMMARY_EDIT_MAX_ITEMS} items.`;
    }
  }
  const texts = [
    ...cleaned.keyPoints,
    ...cleaned.decisions,
    ...cleaned.actionItems.map((item) => item.text),
    ...cleaned.speakerHighlights.map((item) => item.text),
  ];
  if (texts.some((text) => text.length > SUMMARY_EDIT_MAX_ITEM_CHARS)) {
    return `Each item can have at most ${SUMMARY_EDIT_MAX_ITEM_CHARS} characters.`;
  }
  const names = [
    ...cleaned.actionItems.map((item) => item.owner ?? ""),
    ...cleaned.speakerHighlights.map((item) => item.speaker),
  ];
  if (names.some((name) => name.length > SUMMARY_EDIT_MAX_NAME_CHARS)) {
    return `Owner and speaker names can have at most ${SUMMARY_EDIT_MAX_NAME_CHARS} characters.`;
  }
  if (
    cleaned.speakerHighlights.some((item) => item.text.length === 0 || item.speaker.length === 0)
  ) {
    return "Each speaker highlight needs a speaker and text.";
  }
  return null;
}
