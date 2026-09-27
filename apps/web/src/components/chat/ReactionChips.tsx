import { cn } from "@aulora/ui-web";

export interface ReactionGroup {
  readonly emoji: string;
  readonly count: number;
  readonly mine: boolean;
}

export interface ReactionChipsProps {
  readonly groups: readonly ReactionGroup[];
  readonly onToggle: (emoji: string) => void;
  /** Which side of the bubble the chips hug. */
  readonly align?: "start" | "end";
}

/** Compact reaction pills under a bubble; the viewer's own reactions are accented. */
export function ReactionChips({ groups, onToggle, align = "start" }: ReactionChipsProps) {
  return (
    <div className={cn("mt-1 flex flex-wrap gap-1", align === "end" && "justify-end")}>
      {groups.map((group) => (
        <button
          key={group.emoji}
          type="button"
          onClick={() => onToggle(group.emoji)}
          aria-pressed={group.mine}
          aria-label={`${group.emoji} ${group.count}`}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-semibold transition",
            group.mine
              ? "border-accent/50 bg-accent-soft text-accent"
              : "border-border bg-surface-2 text-text-muted hover:border-text-muted/40 hover:text-text",
          )}
        >
          <span aria-hidden="true" className="text-[14px] leading-none">
            {group.emoji}
          </span>
          <span>{group.count}</span>
        </button>
      ))}
    </div>
  );
}
