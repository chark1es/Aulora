import { cn } from "@aulora/ui-web";

export interface ReactionGroup {
  readonly emoji: string;
  readonly count: number;
  readonly mine: boolean;
}

export interface ReactionChipsProps {
  readonly groups: readonly ReactionGroup[];
  readonly onToggle: (emoji: string) => void;
}

/** Compact reaction pills; the caller's own reactions are accented. */
export function ReactionChips({ groups, onToggle }: ReactionChipsProps) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {groups.map((group) => (
        <button
          key={group.emoji}
          type="button"
          onClick={() => onToggle(group.emoji)}
          aria-pressed={group.mine}
          aria-label={`${group.emoji} ${group.count}`}
          className={cn(
            "inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-xs",
            group.mine
              ? "border-accent bg-accent-soft text-accent"
              : "border-border bg-surface-3 text-text-muted hover:text-text",
          )}
        >
          <span aria-hidden="true">{group.emoji}</span>
          <span>{group.count}</span>
        </button>
      ))}
    </div>
  );
}
