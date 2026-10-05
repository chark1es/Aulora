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
  | { readonly type: "mention"; readonly name: string; readonly broadcast: boolean }
  | { readonly type: "channel"; readonly name: string };

export type RichBlock =
  | { readonly type: "code_block"; readonly language: string | null; readonly text: string }
  | { readonly type: "paragraph"; readonly children: readonly InlineSegment[] };

export interface RichTextOptions {
  /** Display names (and mentionable role names) that `@name` may refer to. */
  readonly mentionNames?: readonly string[];
  /** Channel names that `#name` may refer to. */
  readonly channelNames?: readonly string[];
}

const FENCE = /```([^\n`]*)\n?([\s\S]*?)```/g;
const URL_PATTERN = /^https?:\/\/[^\s<>"'`]+/i;
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

/** A set of known `@name`/`#name` targets, ordered longest first. */
export interface NameMatcher {
  readonly names: readonly string[];
}

/** A matcher accepted by {@link parseInline}: names, or a caller-supplied regex. */
export type InlineMatcher = RegExp | NameMatcher;

function nameMatcher(names: readonly string[]): NameMatcher | null {
  const unique = [...new Set(names.filter((name) => name.trim().length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  return unique.length === 0 ? null : { names: unique };
}

function mentionMatcher(names: readonly string[]): NameMatcher | null {
  const base = nameMatcher(names);
  return base === null ? null : { names: ["here", "everyone", ...base.names] };
}

/** Matches `prefix + name` at the start of `rest`, longest name first. */
function matchNameAt(
  rest: string,
  prefix: "@" | "#",
  matcher: InlineMatcher,
): { readonly name: string; readonly length: number } | null {
  if (matcher instanceof RegExp) {
    const match = matcher.exec(rest);
    const name = match?.at(1);
    if (match === null || name === undefined) {
      return null;
    }
    return { name, length: match.at(0)?.length ?? 0 };
  }
  if (rest.charAt(0) !== prefix) {
    return null;
  }
  const body = rest.slice(1).toLowerCase();
  for (const candidate of matcher.names) {
    const lower = candidate.toLowerCase();
    if (!body.startsWith(lower)) {
      continue;
    }
    const after = body.charAt(lower.length);
    if (after === "" || !/\w/.test(after)) {
      return { name: rest.slice(1, 1 + candidate.length), length: 1 + candidate.length };
    }
  }
  return null;
}

/** Splits text into fenced code blocks and inline-formatted paragraphs. */
export function parseRichText(text: string, options: RichTextOptions = {}): RichBlock[] {
  const blocks: RichBlock[] = [];
  const mentions = mentionMatcher(options.mentionNames ?? []);
  const channels = nameMatcher(options.channelNames ?? []);
  let lastIndex = 0;
  for (const match of text.matchAll(FENCE)) {
    const index = match.index;
    pushParagraph(blocks, text.slice(lastIndex, index), mentions, channels);
    const language = (match.at(1) ?? "").trim();
    blocks.push({
      type: "code_block",
      language: language.length > 0 ? language : null,
      text: (match.at(2) ?? "").replace(/\n$/, ""),
    });
    lastIndex = index + match[0].length;
  }
  pushParagraph(blocks, text.slice(lastIndex), mentions, channels);
  return blocks;
}

function pushParagraph(
  blocks: RichBlock[],
  raw: string,
  mentions: InlineMatcher | null,
  channels: InlineMatcher | null,
): void {
  const trimmed = raw.replace(/^\n+|\n+$/g, "");
  if (trimmed.length === 0) {
    return;
  }
  blocks.push({ type: "paragraph", children: parseInline(trimmed, mentions, channels) });
}

/** Parses inline formatting; unmatched markers stay literal text. */
export function parseInline(
  text: string,
  mentions: InlineMatcher | null = null,
  channels: InlineMatcher | null = null,
): InlineSegment[] {
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
    const char = text.charAt(index);
    const atWordStart = index === 0 || /[\s([{]/.test(text.charAt(index - 1));

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
        out.push({
          type: "bold",
          children: parseInline(text.slice(index + 2, end), mentions, channels),
        });
        index = end + 2;
        continue;
      }
    }

    if ((char === "*" || char === "_") && atWordStart && !/\s/.test(text.charAt(index + 1))) {
      const end = findClosing(text, char, index + 1);
      if (end !== -1) {
        flush();
        out.push({
          type: "italic",
          children: parseInline(text.slice(index + 1, end), mentions, channels),
        });
        index = end + 1;
        continue;
      }
    }

    if (char === "@" && atWordStart && mentions !== null) {
      const match = matchNameAt(rest, "@", mentions);
      if (match !== null) {
        flush();
        const lower = match.name.toLowerCase();
        const broadcast = lower === "here" || lower === "everyone";
        out.push({
          type: "mention",
          name: broadcast ? lower : match.name,
          broadcast,
        });
        index += match.length;
        continue;
      }
    }

    if (char === "#" && atWordStart && channels !== null) {
      const match = matchNameAt(rest, "#", channels);
      if (match !== null) {
        flush();
        out.push({ type: "channel", name: match.name });
        index += match.length;
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
    if (text.charAt(index) === "\n") {
      return -1;
    }
    if (
      text.charAt(index) === marker &&
      !/\s/.test(text.charAt(index - 1)) &&
      !/\w/.test(text.charAt(index + 1))
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
        case "channel":
          return `#${segment.name}`;
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
