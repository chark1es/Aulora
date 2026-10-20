/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { BOT_LIMITS } from "@aulora/core";
import { Text } from "@aulora/ui-web";
import { type KeyboardEvent as ReactKeyboardEvent, useRef } from "react";
import { botFileBytes, formatBytes } from "./bot-format";

const TAB = "  ";

/**
 * A plain, controlled source editor: a monospace textarea that turns Tab into
 * two spaces, with a line count and a byte counter against the per-file limit.
 * Deliberately dependency-free so the admin bundle stays small.
 */
export function BotFileEditor({
  path,
  content,
  disabled,
  onChange,
}: {
  readonly path: string;
  readonly content: string;
  readonly disabled: boolean;
  readonly onChange: (content: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const bytes = botFileBytes(content);
  const lines = content.length === 0 ? 1 : content.split("\n").length;
  const overLimit = bytes > BOT_LIMITS.maxFileBytes;

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Tab") {
      return;
    }
    event.preventDefault();
    const start = event.currentTarget.selectionStart;
    const end = event.currentTarget.selectionEnd;
    onChange(`${content.slice(0, start)}${TAB}${content.slice(end)}`);
    requestAnimationFrame(() => {
      const node = ref.current;
      if (node !== null) {
        node.selectionStart = start + TAB.length;
        node.selectionEnd = start + TAB.length;
      }
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <textarea
        ref={ref}
        aria-label={`Code for ${path}`}
        value={content}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        onKeyDown={handleKeyDown}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        className="min-h-[280px] flex-1 resize-y rounded-input border border-border bg-surface-3 p-3 font-mono text-[13px] leading-snug text-text transition focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-50"
      />
      <div className="flex items-center justify-between gap-2">
        <Text size="xs" tone="muted">
          {lines} {lines === 1 ? "line" : "lines"}
        </Text>
        <Text size="xs" tone={overLimit ? "danger" : "muted"}>
          {formatBytes(bytes)} of {formatBytes(BOT_LIMITS.maxFileBytes)}
        </Text>
      </div>
      {overLimit && (
        <Text role="alert" tone="danger" size="xs">
          This file is over the {formatBytes(BOT_LIMITS.maxFileBytes)} limit.
        </Text>
      )}
    </div>
  );
}
