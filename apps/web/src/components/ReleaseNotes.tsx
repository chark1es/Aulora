import { Button, cn } from "@aulora/ui-web";
import { useState } from "react";
import { NoteMarkdown } from "./notes/NoteMarkdown";

export interface ReleaseNotesProps {
  readonly notes: string | null;
  /** Class applied to the outer section, e.g. spacing inside a card. */
  readonly className?: string;
}

const COLLAPSE_THRESHOLD = 220;

/**
 * Compact "What’s new" block. Release notes render through the Notes Markdown
 * subset (plain data, never HTML) so untrusted notes cannot inject markup, and
 * links open externally without an opener. Long notes collapse to a few lines
 * with a Show more toggle.
 */
export function ReleaseNotes(props: ReleaseNotesProps) {
  const { notes, className } = props;
  const [expanded, setExpanded] = useState(false);
  if (notes === null || notes.trim().length === 0) {
    return null;
  }
  const collapsible = notes.trim().length > COLLAPSE_THRESHOLD;
  const collapsed = collapsible && !expanded;
  return (
    <section
      className={cn("flex flex-col gap-2", className)}
      aria-label="What’s new"
      data-testid="release-notes"
    >
      <h4 className="text-[12px] font-semibold uppercase tracking-wide text-text-muted">
        What’s new
      </h4>
      <div className={cn("relative", collapsed && "max-h-[5.5rem] overflow-hidden")}>
        <NoteMarkdown text={notes} />
        {collapsed && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface-2 to-transparent"
          />
        )}
      </div>
      {collapsible && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start px-0"
          onClick={() => {
            setExpanded((value) => !value);
          }}
        >
          {expanded ? "Show less" : "Show more"}
        </Button>
      )}
    </section>
  );
}
