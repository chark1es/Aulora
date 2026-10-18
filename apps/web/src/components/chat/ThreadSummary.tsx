import { activityLabel } from "@aulora/core";
import { cn, Icon } from "@aulora/ui-web";
import { PersonAvatar } from "./member-avatars";

const SHOWN_REPLIERS = 3;

/**
 * Overlapping avatars of the people who replied: up to three, then a "+" when
 * the thread has more. With no participant data it falls back to a thread icon.
 */
function ReplierStack({ userIds }: { readonly userIds: readonly string[] }) {
  if (userIds.length === 0) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Icon name="thread" size={12} />
      </span>
    );
  }
  const shown = userIds.slice(0, SHOWN_REPLIERS);
  const hasMore = userIds.length > SHOWN_REPLIERS;
  return (
    <span data-testid="thread-repliers" className="ml-0.5 flex shrink-0 items-center -space-x-1.5">
      {shown.map((userId) => (
        <PersonAvatar
          key={userId}
          userId={userId}
          size={20}
          className="ring-2 ring-[var(--aulora-chat)] group-hover/thread:ring-surface-3"
        />
      ))}
      {hasMore && (
        <span
          aria-hidden="true"
          className="relative flex h-5 w-5 items-center justify-center rounded-full bg-surface-3 text-text-muted ring-2 ring-[var(--aulora-chat)] group-hover/thread:ring-surface-3"
        >
          <Icon name="plus" size={12} block />
        </span>
      )}
    </span>
  );
}

function threadRepliesLabel(count: number) {
  return count === 1 ? "1 reply" : `${count} replies`;
}

/** The muted "last reply …" note beside a thread summary, or null without one. */
function lastReplyNote(at: number | null | undefined): string | null {
  if (at === null || at === undefined) {
    return null;
  }
  return `· last reply ${activityLabel(at)}`;
}

/**
 * The "N replies" row under a thread root. It stays quiet — a muted line with
 * an accented count — sitting directly under the message text, led by the
 * avatars of whoever replied. The whole row is the hit target.
 */
export function ThreadSummary({
  replyCount,
  lastReplyAt,
  participantIds,
  mirror,
  onOpen,
}: {
  readonly replyCount: number;
  readonly lastReplyAt: number | null | undefined;
  readonly participantIds: readonly string[];
  readonly mirror: boolean;
  readonly onOpen: () => void;
}) {
  const label = threadRepliesLabel(replyCount);
  const note = lastReplyNote(lastReplyAt);
  return (
    <div className={cn("mt-1", mirror ? "pr-[42px]" : "pl-[42px]")}>
      <button
        type="button"
        aria-label={`Open thread, ${label}`}
        onClick={onOpen}
        className={cn(
          "group/thread flex min-h-7 w-full min-w-0 items-center gap-1.5 rounded-[7px] px-1.5 py-0.5 text-left transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:bg-surface-3",
          mirror ? "-mr-1.5 flex-row-reverse" : "-ml-1.5",
        )}
      >
        <ReplierStack userIds={participantIds} />
        <span className="shrink-0 text-[12px] font-semibold leading-4 text-accent">{label}</span>
        {note !== null && (
          <span className="min-w-0 truncate text-[11px] leading-4 text-text-muted">{note}</span>
        )}
        <Icon
          name="chevron-right"
          size={14}
          className={cn(
            "shrink-0 text-text-muted opacity-0 transition group-hover/thread:translate-x-0 group-hover/thread:opacity-100 group-focus-visible/thread:translate-x-0 group-focus-visible/thread:opacity-100",
            mirror ? "rotate-180 translate-x-0.5" : "-translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
