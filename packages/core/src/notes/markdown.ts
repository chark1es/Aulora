/**
 * The Notes Markdown subset, parsed into plain data so each renderer (React
 * DOM, React Native) maps blocks onto its own elements. Nothing here produces
 * HTML, so note text can never inject markup.
 *
 * Blocks: fenced code, headings, unordered/ordered lists, blockquotes,
 * horizontal rules and paragraphs. Inline formatting reuses the message
 * renderer's `parseInline` (code, links, bold, italic).
 */

import { type InlineSegment, parseInline } from "../chat/rich-text.js";

export type NoteHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type NoteBlock =
  | {
      readonly type: "heading";
      readonly level: NoteHeadingLevel;
      readonly children: readonly InlineSegment[];
    }
  | { readonly type: "paragraph"; readonly children: readonly InlineSegment[] }
  | { readonly type: "code_block"; readonly language: string | null; readonly text: string }
  | {
      readonly type: "list";
      readonly ordered: boolean;
      readonly items: readonly (readonly InlineSegment[])[];
    }
  | { readonly type: "blockquote"; readonly children: readonly InlineSegment[] }
  | { readonly type: "divider" };

const FENCE = /```([^\n`]*)\n?([\s\S]*?)```/g;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const DIVIDER = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BLOCKQUOTE = /^\s*>\s?(.*)$/;
const UNORDERED = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const BLANK = /^\s*$/;

/** Splits Markdown into block-level data for rendering. */
export function parseNoteMarkdown(text: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(FENCE)) {
    parseLines(blocks, text.slice(lastIndex, match.index));
    const language = (match.at(1) ?? "").trim();
    blocks.push({
      type: "code_block",
      language: language.length > 0 ? language : null,
      text: (match.at(2) ?? "").replace(/\n$/, ""),
    });
    lastIndex = match.index + match[0].length;
  }
  parseLines(blocks, text.slice(lastIndex));
  return blocks;
}

function parseLines(blocks: NoteBlock[], raw: string): void {
  const lines = raw.split("\n");
  let index = 0;
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const joined = paragraph.join("\n").trim();
    paragraph = [];
    if (joined.length > 0) {
      blocks.push({ type: "paragraph", children: parseInline(joined) });
    }
  };
  const flushList = () => {
    if (list === null) return;
    const items = list.items;
    const ordered = list.ordered;
    list = null;
    if (items.length > 0) {
      blocks.push({ type: "list", ordered, items: items.map((item) => parseInline(item)) });
    }
  };

  while (index < lines.length) {
    const line = lines.at(index) ?? "";
    index += 1;

    if (BLANK.test(line)) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      flushParagraph();
      flushList();
      const level = heading.at(1)?.length ?? 1;
      blocks.push({
        type: "heading",
        level: Math.min(6, Math.max(1, level)) as NoteHeadingLevel,
        children: parseInline((heading.at(2) ?? "").trim()),
      });
      continue;
    }

    if (DIVIDER.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "divider" });
      continue;
    }

    const quote = BLOCKQUOTE.exec(line);
    if (quote !== null) {
      flushParagraph();
      flushList();
      const quoteLines: string[] = [quote.at(1) ?? ""];
      while (index < lines.length) {
        const next = BLOCKQUOTE.exec(lines.at(index) ?? "");
        if (next === null) break;
        quoteLines.push(next.at(1) ?? "");
        index += 1;
      }
      const joined = quoteLines.join("\n").trim();
      if (joined.length > 0) {
        blocks.push({ type: "blockquote", children: parseInline(joined) });
      }
      continue;
    }

    const unordered = UNORDERED.exec(line);
    const ordered = unordered === null ? ORDERED.exec(line) : null;
    if (unordered !== null || ordered !== null) {
      flushParagraph();
      const isOrdered = ordered !== null;
      const item = (unordered?.[1] ?? ordered?.[1] ?? "").trim();
      if (list !== null && list.ordered !== isOrdered) {
        flushList();
      }
      if (list === null) list = { ordered: isOrdered, items: [] };
      list.items.push(item);
      continue;
    }

    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
}

/** Plain text of a parsed document, e.g. for previews and indexing. */
export function noteBlocksToPlainText(blocks: readonly NoteBlock[]): string {
  const inline = (segments: readonly InlineSegment[]): string =>
    segments
      .map((segment) => {
        switch (segment.type) {
          case "text":
          case "code":
          case "link":
            return segment.text;
          case "mention":
            return `@${segment.name}`;
          case "channel":
            return `#${segment.name}`;
          default:
            return inline(segment.children);
        }
      })
      .join("");
  return blocks
    .map((block) => {
      switch (block.type) {
        case "code_block":
          return block.text;
        case "divider":
          return "";
        case "list":
          return block.items.map(inline).join("\n");
        default:
          return inline(block.children);
      }
    })
    .join("\n");
}
