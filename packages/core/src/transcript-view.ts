/**
 * Presentation helpers for transcripts: defensive parsing of the stored summary
 * JSON, timestamp formatting and grouping consecutive lines by speaker.
 *
 * A summary is model output derived from untrusted speech. The server validates
 * and length-limits it; the client re-validates anyway and returns plain
 * strings, which the UI renders as text nodes, never as markup.
 */

import {
  speakerFallbackLabel,
  TRANSCRIPTION_SUMMARY_MAX_OUTPUT_CHARS,
  type TranscriptSummary,
} from "./transcription";

const MAX_ITEMS = 50;
const MAX_ITEM_CHARS = 2_000;

function cleanText(value: unknown, limit: number): string {
  if (typeof value !== "string") {
    return "";
  }
  let out = "";
  for (const character of value.normalize("NFKC")) {
    const code = character.codePointAt(0) ?? 0;
    const control = code < 0x20 && code !== 0x0a && code !== 0x09;
    const bidi = (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
    if (control || (code >= 0x7f && code <= 0x9f) || bidi) {
      continue;
    }
    out += character;
  }
  return out.trim().slice(0, limit);
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .slice(0, MAX_ITEMS)
    .map((item) => cleanText(item, MAX_ITEM_CHARS))
    .filter((item) => item.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses the `summary` string from `transcription.getSession`. Returns `null`
 * when there is nothing to show (absent, not JSON, not an object, or empty), so
 * the caller can render the right empty/error state.
 */
export function parseTranscriptSummary(raw: string | null | undefined): TranscriptSummary | null {
  if (raw === null || raw === undefined || raw.length === 0) {
    return null;
  }
  if (raw.length > TRANSCRIPTION_SUMMARY_MAX_OUTPUT_CHARS * 2) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const actionItems = Array.isArray(parsed.actionItems)
    ? parsed.actionItems
        .slice(0, MAX_ITEMS)
        .map((item) => {
          if (!isRecord(item)) {
            return null;
          }
          const text = cleanText(item.text, MAX_ITEM_CHARS);
          if (text.length === 0) {
            return null;
          }
          const owner = cleanText(item.owner, 120);
          return { text, owner: owner.length > 0 ? owner : null };
        })
        .filter((item): item is { text: string; owner: string | null } => item !== null)
    : [];
  const speakerHighlights = Array.isArray(parsed.speakerHighlights)
    ? parsed.speakerHighlights
        .slice(0, MAX_ITEMS)
        .map((item) => {
          if (!isRecord(item)) {
            return null;
          }
          const speaker = cleanText(item.speaker, 120);
          const text = cleanText(item.text, MAX_ITEM_CHARS);
          return speaker.length > 0 && text.length > 0 ? { speaker, text } : null;
        })
        .filter((item): item is { speaker: string; text: string } => item !== null)
    : [];
  const language = cleanText(parsed.language, 20);
  const summary: TranscriptSummary = {
    overview: cleanText(parsed.overview, TRANSCRIPTION_SUMMARY_MAX_OUTPUT_CHARS),
    keyPoints: stringList(parsed.keyPoints),
    decisions: stringList(parsed.decisions),
    actionItems,
    speakerHighlights,
    language: language.length > 0 ? language : null,
  };
  return isEmptySummary(summary) ? null : summary;
}

/** True when a summary carries nothing to display. */
export function isEmptySummary(summary: TranscriptSummary): boolean {
  return (
    summary.overview.length === 0 &&
    summary.keyPoints.length === 0 &&
    summary.decisions.length === 0 &&
    summary.actionItems.length === 0 &&
    summary.speakerHighlights.length === 0
  );
}

/** "0:07", "12:03", "1:02:09" from a millisecond offset into the session. */
export function formatTranscriptTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

export interface TranscriptLine {
  /**
   * The segment document id: unique across the whole session. `seq` is per
   * speaker and can repeat for the same speaker after a transcriber restart.
   */
  readonly id: string;
  readonly seq: number;
  readonly speakerKey: string;
  readonly speakerName: string;
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface TranscriptTurn {
  readonly key: string;
  readonly speakerKey: string;
  readonly speakerName: string;
  readonly isGuest: boolean;
  readonly startMs: number;
  readonly text: string;
}

/** Longest quiet gap that still lets one speaker's lines read as a single turn. */
export const TURN_GAP_MS = 8_000;

/**
 * Merges consecutive lines by one speaker into turns so a transcript reads like
 * a conversation rather than one row per recognized phrase. Lines are expected
 * in the order `transcription.listSegments` returns them (by start time).
 */
export function groupTranscriptTurns(lines: readonly TranscriptLine[]): TranscriptTurn[] {
  const turns: { -readonly [K in keyof TranscriptTurn]: TranscriptTurn[K] }[] = [];
  let lastEnd = 0;
  for (const line of lines) {
    const text = line.text.trim();
    if (text.length === 0) {
      continue;
    }
    const last = turns.at(-1);
    const name =
      line.speakerName.trim().length > 0 ? line.speakerName : speakerFallbackLabel(line.speakerKey);
    if (
      last !== undefined &&
      last.speakerKey === line.speakerKey &&
      line.startMs - lastEnd <= TURN_GAP_MS
    ) {
      last.text = `${last.text} ${text}`;
    } else {
      turns.push({
        // The first segment's id: `seq` is per speaker and may repeat, even for
        // one speaker, after a transcriber restart.
        key: line.id,
        speakerKey: line.speakerKey,
        speakerName: name,
        isGuest: line.speakerKey.startsWith("guest:"),
        startMs: line.startMs,
        text,
      });
    }
    lastEnd = line.endMs;
  }
  return turns;
}
