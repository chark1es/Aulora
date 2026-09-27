import { type InlineSegment, parseRichText } from "@aulora/core";
import { cn } from "@aulora/ui-web";
import { type ReactNode, useMemo } from "react";

export interface RichTextProps {
  readonly text: string;
  readonly mentionNames: readonly string[];
  /** The viewer's display name; mentions of them are highlighted. */
  readonly viewerName: string;
  /** Rendering on the accent (own) bubble: invert link and code colors. */
  readonly onAccent?: boolean;
}

/**
 * Renders the message Markdown subset as React elements. The parser returns
 * data, never HTML, so message text cannot inject markup; links are
 * http(s)-only and open in a new tab without an opener.
 */
export function RichText({ text, mentionNames, viewerName, onAccent = false }: RichTextProps) {
  const blocks = useMemo(() => parseRichText(text, { mentionNames }), [text, mentionNames]);
  return (
    <div className="flex flex-col gap-1.5">
      {blocks.map((block, index) => {
        const key = `${block.type}:${index}`;
        if (block.type === "code_block") {
          return (
            <pre
              key={key}
              className={cn(
                "overflow-x-auto rounded-[8px] px-3 py-2 font-mono text-[12.5px] leading-relaxed",
                onAccent ? "bg-black/20 text-on-accent" : "bg-surface-3 text-text",
              )}
            >
              <code>{block.text}</code>
            </pre>
          );
        }
        return (
          <p key={key} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {renderInline(block.children, viewerName, onAccent)}
          </p>
        );
      })}
    </div>
  );
}

function renderInline(
  segments: readonly InlineSegment[],
  viewerName: string,
  onAccent: boolean,
): ReactNode[] {
  return segments.map((segment, index) => {
    const key = `${segment.type}:${index}`;
    switch (segment.type) {
      case "text":
        return <span key={key}>{segment.text}</span>;
      case "code":
        return (
          <code
            key={key}
            className={cn(
              "rounded-[5px] px-1 py-px font-mono text-[0.88em]",
              onAccent ? "bg-black/20" : "bg-surface-3 text-accent",
            )}
          >
            {segment.text}
          </code>
        );
      case "bold":
        return (
          <strong key={key} className="font-semibold">
            {renderInline(segment.children, viewerName, onAccent)}
          </strong>
        );
      case "italic":
        return (
          <em key={key} className="italic">
            {renderInline(segment.children, viewerName, onAccent)}
          </em>
        );
      case "link":
        return (
          <a
            key={key}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "underline decoration-1 underline-offset-2",
              onAccent ? "text-on-accent" : "text-accent hover:brightness-110",
            )}
          >
            {segment.text}
          </a>
        );
      case "mention": {
        const self = segment.broadcast || segment.name.toLowerCase() === viewerName.toLowerCase();
        return (
          <span
            key={key}
            className={cn(
              "rounded-[5px] px-1 font-semibold",
              onAccent
                ? "bg-black/20 text-on-accent"
                : self
                  ? "bg-accent text-on-accent ring-1 ring-accent/40"
                  : "bg-accent/15 text-accent ring-1 ring-accent/25",
            )}
          >
            @{segment.name}
          </span>
        );
      }
      default:
        return null;
    }
  });
}
