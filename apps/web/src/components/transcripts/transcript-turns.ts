import { groupTranscriptTurns, type TranscriptLine, type TranscriptTurn } from "@aulora/core";

export interface EditableLine extends TranscriptLine {
  readonly edited: boolean;
}

export interface EditableTurn extends TranscriptTurn {
  /** The non-empty lines the turn was merged from, in order. */
  readonly lines: readonly EditableLine[];
  readonly edited: boolean;
}

/**
 * Groups lines into turns with `groupTranscriptTurns` (so the merge rules stay
 * in one place) and keeps the segment ids behind each turn. A turn starts at
 * the line whose id is its key and takes the following non-blank lines until
 * the next turn's key.
 */
export function groupEditableTurns(lines: readonly EditableLine[]): EditableTurn[] {
  const turns = groupTranscriptTurns(lines);
  const nonBlank = lines.filter((line) => line.text.trim().length > 0);
  const out: EditableTurn[] = [];
  let cursor = 0;
  for (const [index, turn] of turns.entries()) {
    const nextKey = turns[index + 1]?.key;
    const members: EditableLine[] = [];
    while (cursor < nonBlank.length) {
      const line = nonBlank.at(cursor);
      if (line === undefined || (members.length > 0 && line.id === nextKey)) {
        break;
      }
      members.push(line);
      cursor += 1;
    }
    out.push({ ...turn, lines: members, edited: members.some((line) => line.edited) });
  }
  return out;
}
