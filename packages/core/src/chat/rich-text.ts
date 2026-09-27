/**
 * The message Markdown subset, parsed into plain data so each renderer (React
 * DOM, React Native) maps segments onto its own elements. Nothing here
 * produces HTML, so decrypted text can never inject markup.
 *
 * Blocks: fenced code (```lang\n…```) and paragraphs. Inline, in precedence
 * order: `code`, links (http/https only), **bold**, *italic* / _italic_, and
 * mentions of known names plus @here / @everyone.
 */

export type InlineSegment =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "code"; readonly text: string }
  | { readonly type: "bold"; readonly children: readonly InlineSegment[] }
  | { readonly type: "italic"; readonly children: readonly InlineSegment[] }
  | { readonly type: "link"; readonly href: string; readonly text: string }
  | { readonly type: "mention"; readonly name: string; readonly broadcast: boolean };

export type RichBlock =
  | { readonly type: "code_block"; readonly language: string | null; readonly text: string }
  | { readonly type: "paragraph"; readonly children: readonly InlineSegment[] };

export interface RichTextOptions {
  /** Display names (and mentionable role names) that `@name` may refer to. */
  readonly mentionNames?: readonly string[];
}

const FENCE = /```([^\n`]*)\n?([\s\S]*?)```/g;
const URL_PATTERN = /^https?:\/\/[^\s<>"'`]+/i;
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

/** Splits text into fenced code blocks and inline-formatted paragraphs. */
export function parseRichText(text: string, options: RichTextOptions = {}): RichBlock[] {
  const blocks: RichBlock[] = [];
  const mentions = mentionMatcher(options.mentionNames ?? []);
  let lastIndex = 0;
  for (const match of text.matchAll(FENCE)) {
    const index = match.index ?? 0;
    pushParagraph(blocks, text.slice(lastIndex, index), mentions);
    const language = (match[1] ?? "").trim();
    blocks.push({
      type: "code_block",
      language: language.length > 0 ? language : null,
      text: (match[2] ?? "").replace(/\n$/, ""),
    });
    lastIndex = index + match[0].length;
  }
  pushParagraph(blocks, text.slice(lastIndex), mentions);
  return blocks;
}

function pushParagraph(blocks: RichBlock[], raw: string, mentions: RegExp | null): void {
  const trimmed = raw.replace(/^\n+|\n+$/g, "");
  if (trimmed.length === 0) {
    return;
  }
  blocks.push({ type: "paragraph", children: parseInline(trimmed, mentions) });
}

function mentionMatcher(names: readonly string[]): RegExp | null {
  const escaped = [...new Set(names.filter((name) => name.trim().length > 0))]
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const alternatives = ["here", "everyone", ...escaped];
  return new RegExp(`^@(${alternatives.join("|")})(?![\\w])`, "i");
}

/** Parses inline formatting; unmatched markers stay literal text. */
export function parseInline(text: string, mentions: RegExp | null = null): InlineSegment[] {
  const out: InlineSegment[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer.length > 0) {
      out.push({ type: "text", text: buffer });
      buffer = "";
    }
  };

  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);
    const char = text[index];
    const atWordStart = index === 0 || /[\s([{]/.test(text[index - 1] ?? "");

    if (char === "`") {
      const end = text.indexOf("`", index + 1);
      if (end > index + 1) {
        flush();
        out.push({ type: "code", text: text.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    if ((char === "h" || char === "H") && atWordStart) {
      const url = URL_PATTERN.exec(rest)?.[0];
      if (url !== undefined) {
        const clean = url.replace(TRAILING_PUNCTUATION, "");
        flush();
        out.push({ type: "link", href: clean, text: clean });
        index += clean.length;
        continue;
      }
    }

    if (rest.startsWith("**")) {
      const end = text.indexOf("**", index + 2);
      if (end > index + 2) {
        flush();
        out.push({ type: "bold", children: parseInline(text.slice(index + 2, end), mentions) });
        index = end + 2;
        continue;
      }
    }

    if ((char === "*" || char === "_") && atWordStart && !/\s/.test(text[index + 1] ?? " ")) {
      const end = findClosing(text, char, index + 1);
      if (end !== -1) {
        flush();
        out.push({ type: "italic", children: parseInline(text.slice(index + 1, end), mentions) });
        index = end + 1;
        continue;
      }
    }

    if (char === "@" && atWordStart && mentions !== null) {
      const match = mentions.exec(rest);
      if (match !== null) {
        const name = match[1] ?? "";
        flush();
        const lower = name.toLowerCase();
        out.push({
          type: "mention",
          name: lower === "here" || lower === "everyone" ? lower : name,
          broadcast: lower === "here" || lower === "everyone",
        });
        index += match[0].length;
        continue;
      }
    }

    buffer += char;
    index += 1;
  }
  flush();
  return out;
}

/** A closing single marker that ends a word (not followed by a word char). */
function findClosing(text: string, marker: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === "\n") {
      return -1;
    }
    if (
      text[index] === marker &&
      !/\s/.test(text[index - 1] ?? " ") &&
      !/\w/.test(text[index + 1] ?? "")
    ) {
      return index;
    }
  }
  return -1;
}

/** Plain text of inline segments, e.g. for notification previews. */
export function inlineToPlainText(segments: readonly InlineSegment[]): string {
  return segments
    .map((segment) => {
      switch (segment.type) {
        case "text":
        case "code":
        case "link":
          return segment.text;
        case "mention":
          return `@${segment.name}`;
        default:
          return inlineToPlainText(segment.children);
      }
    })
    .join("");
}

/** Whether the viewer is mentioned: by name, or by @here / @everyone. */
export function mentionsViewer(blocks: readonly RichBlock[], viewerName: string): boolean {
  const target = viewerName.toLowerCase();
  const visit = (segments: readonly InlineSegment[]): boolean =>
    segments.some((segment) => {
      if (segment.type === "mention") {
        return segment.broadcast || segment.name.toLowerCase() === target;
      }
      if (segment.type === "bold" || segment.type === "italic") {
        return visit(segment.children);
      }
      return false;
    });
  return blocks.some((block) => block.type === "paragraph" && visit(block.children));
}
