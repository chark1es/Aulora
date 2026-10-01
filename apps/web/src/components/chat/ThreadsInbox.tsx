import { activityLabel } from "@aulora/core";
import { Spinner } from "@aulora/ui-web";
import { PersonAvatar } from "./member-avatars";

/** One row of the Threads inbox, as returned by `api.messages.threadInbox`. */
export interface ThreadInboxItem {
  readonly id: string;
  readonly channelId: string;
  readonly authorId: string;
  readonly body: string;
  readonly createdAt: number;
  readonly replyCount: number;
  readonly lastReplyAt: number | null;
  readonly participantIds: readonly string[];
  readonly mentionedUserIds: readonly string[];
  readonly viewerParticipated: boolean;
  readonly viewerMentioned: boolean;
}

export interface ThreadsInboxProps {
  readonly threads: readonly ThreadInboxItem[];
  readonly loading: boolean;
  /** Raw channel name per channel id; text channels only. */
  readonly channelNames: ReadonlyMap<string, string>;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly memberColors?: ReadonlyMap<string, string>;
  /** Display title per channel id, used for DMs (named after their members). */
  readonly titles: ReadonlyMap<string, string>;
  readonly ownUserId: string;
  readonly onOpen: (thread: ThreadInboxItem) => void;
}

function replyLabel(count: number): string {
  return count === 1 ? "1 reply" : `${count} replies`;
}

/**
 * The "Threads" main view: every thread the viewer replied to or was mentioned
 * in, most recently active first. Selecting a row opens the thread panel.
 */
export function ThreadsInbox({
  threads,
  loading,
  channelNames,
  memberNames,
  memberColors,
  titles,
  ownUserId,
  onOpen,
}: ThreadsInboxProps) {
  if (loading) {
    return (
      <div
        data-testid="threads-inbox"
        aria-busy="true"
        className="flex flex-1 flex-col items-center justify-center gap-3 p-8"
      >
        <Spinner size={26} label="Loading threads" />
        <p className="text-sm text-text-muted">Loading threads…</p>
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div
        data-testid="threads-inbox"
        className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
          <span className="text-[22px] leading-none" aria-hidden="true">
            #
          </span>
        </span>
        <h3 className="text-lg font-semibold text-text">No threads yet</h3>
        <p className="max-w-xs text-sm text-text-muted">
          Threads you reply to or get mentioned in will show up here.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="threads-inbox" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      <ul aria-label="Threads" className="flex flex-col gap-0.5">
        {threads.map((thread) => {
          const channelName = channelNames.get(thread.channelId);
          const channelLabel =
            channelName !== undefined
              ? `#${channelName}`
              : (titles.get(thread.channelId) ?? "Direct message");
          const authorName =
            thread.authorId === ownUserId
              ? "You"
              : (memberNames.get(thread.authorId) ?? "Unknown member");
          const roleColor = memberColors?.get(thread.authorId);
          const lastActivity = thread.lastReplyAt ?? thread.createdAt;
          return (
            <li key={thread.id}>
              <button
                type="button"
                data-testid={`thread-row-${thread.id}`}
                onClick={() => onOpen(thread)}
                className="flex w-full items-start gap-3 rounded-[8px] px-2.5 py-2 text-left transition hover:bg-surface-3"
              >
                <PersonAvatar userId={thread.authorId} size={32} roleColor={roleColor} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2 text-xs">
                    <span className="truncate font-semibold text-text">{authorName}</span>
                    <span className="truncate text-text-muted">{channelLabel}</span>
                    {thread.viewerMentioned && (
                      <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                        Mentioned you
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-text-muted">
                      {activityLabel(lastActivity)}
                    </span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 text-sm text-text">{thread.body}</span>
                  <span className="mt-1 block text-xs text-text-muted">
                    {replyLabel(thread.replyCount)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
