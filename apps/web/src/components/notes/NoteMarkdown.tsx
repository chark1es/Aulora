import { type InlineSegment, type NoteBlock, parseNoteMarkdown } from "@aulora/core";
import { cn } from "@aulora/ui-web";
import { type ReactNode, useMemo } from "react";

const HEADING_CLASSES = new Map<number, string>([
  [1, "text-2xl font-semibold tracking-tight"],
  [2, "text-xl font-semibold tracking-tight"],
  [3, "text-lg font-semibold"],
  [4, "text-base font-semibold"],
  [5, "text-sm font-semibold uppercase tracking-wide"],
  [6, "text-xs font-semibold uppercase tracking-wide text-text-muted"],
]);

/**
 * Renders the Notes Markdown subset as React elements. The parser returns data,
 * never HTML, so note text can never inject markup; links are http(s)-only and
 * open in a new tab without an opener.
 */
export function NoteMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseNoteMarkdown(text), [text]);
  if (blocks.length === 0) {
    return <p className={cn("text-[13px] text-text-muted", className)}>Nothing here yet.</p>;
  }
  return (
    <div
      className={cn(
        "flex flex-col gap-3 break-words text-[14px] leading-relaxed text-text",
        className,
      )}
    >
      {blocks.map((block, index) => {
        const blockKey = `${block.type}:${index}`;
        return renderBlock(block, blockKey);
      })}
    </div>
  );
}

function renderBlock(block: NoteBlock, key: string): ReactNode {
  switch (block.type) {
    case "heading": {
      const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return (
        <Tag key={key} className={cn("text-text", HEADING_CLASSES.get(block.level))}>
          {renderInline(block.children)}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p key={key} className="whitespace-pre-wrap [overflow-wrap:anywhere]">
          {renderInline(block.children)}
        </p>
      );
    case "code_block":
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-[10px] border border-border bg-surface-3 px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-text"
        >
          <code>{block.text}</code>
        </pre>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          key={key}
          className={cn("flex flex-col gap-1 pl-5", block.ordered ? "list-decimal" : "list-disc")}
        >
          {block.items.map((item, index) => {
            const itemKey = `${key}:item:${index}`;
            return (
              <li key={itemKey} className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                {renderInline(item)}
              </li>
            );
          })}
        </Tag>
      );
    }
    case "blockquote":
      return (
        <blockquote key={key} className="border-l-2 border-accent/50 pl-3 italic text-text-muted">
          {renderInline(block.children)}
        </blockquote>
      );
    case "divider":
      return <hr key={key} className="border-border" />;
    default:
      return null;
  }
}

function renderInline(segments: readonly InlineSegment[]): ReactNode[] {
  return segments.map((segment, index) => {
    const key = `${segment.type}:${index}`;
    switch (segment.type) {
      case "text":
        return <span key={key}>{segment.text}</span>;
      case "code":
        return (
          <code
            key={key}
            className="rounded-[5px] bg-surface-3 px-1 py-px font-mono text-[0.88em] text-accent"
          >
            {segment.text}
          </code>
        );
      case "bold":
        return (
          <strong key={key} className="font-semibold">
            {renderInline(segment.children)}
          </strong>
        );
      case "italic":
        return (
          <em key={key} className="italic">
            {renderInline(segment.children)}
          </em>
        );
      case "link":
        return (
          <a
            key={key}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline decoration-1 underline-offset-2 hover:brightness-110"
          >
            {segment.text}
          </a>
        );
      case "mention":
        return (
          <span key={key} className="font-semibold text-accent">
            @{segment.name}
          </span>
        );
      case "channel":
        return (
          <span key={key} className="font-semibold text-accent">
            #{segment.name}
          </span>
        );
      default:
        return null;
    }
  });
}
