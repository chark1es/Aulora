import { dayLabel, GROUP_WINDOW_MS, type MessagePayload, startOfLocalDay } from "@aulora/core";

/** One entry of the message list: a day separator, a system event, or a message. */
export type MessageListRow =
  | { readonly kind: "day"; readonly key: string; readonly label: string }
  | {
      readonly kind: "system";
      readonly key: string;
      readonly actorId: string | undefined;
      /** The message the event refers to (e.g. the pinned message). */
      readonly targetId: string | undefined;
    }
  | {
      readonly kind: "message";
      readonly key: string;
      readonly message: MessagePayload;
      /** Continues the previous message's author block: no avatar or name. */
      readonly grouped: boolean;
    };

/** Whether `message` continues the author block that `previous` belongs to. */
function continuesBlock(previous: MessagePayload, message: MessagePayload): boolean {
  return (
    previous.systemKind === undefined &&
    previous.authorId === message.authorId &&
    message.createdAt - previous.createdAt < GROUP_WINDOW_MS &&
    (message.replyToId === null || message.replyToId === undefined)
  );
}

/**
 * Turns messages in chronological order into list rows, newest first, because
 * the list is inverted so it opens on the latest message. A day separator
 * follows the messages of its day in the array, so it draws above them.
 * Deleted messages are omitted: the server keeps the soft-delete row for
 * audit, but the client renders no tombstone.
 */
export function buildMessageRows(messages: readonly MessagePayload[]): MessageListRow[] {
  const visible = messages.filter((message) => message.deletedAt === null);
  const rows: MessageListRow[] = [];
  visible.forEach((message, index) => {
    const previous = visible[index - 1];
    const day = startOfLocalDay(message.createdAt);
    const sameDay = previous !== undefined && startOfLocalDay(previous.createdAt) === day;
    if (!sameDay) rows.push({ kind: "day", key: `day-${day}`, label: dayLabel(day) });
    if (message.systemKind === "pin") {
      rows.push({
        kind: "system",
        key: message.id,
        actorId: message.systemActorId,
        targetId: message.systemTargetId,
      });
      return;
    }
    rows.push({
      kind: "message",
      key: message.id,
      message,
      grouped: sameDay && continuesBlock(previous, message),
    });
  });
  return rows.reverse();
}

/** One emoji on a message with how many people chose it. */
export interface ReactionGroup {
  readonly emoji: string;
  readonly count: number;
  /** The viewer is one of them. */
  readonly mine: boolean;
}

/** Collapses individual reactions into one group per emoji, in first-seen order. */
export function groupReactions(
  reactions: readonly { readonly userId: string; readonly emoji: string }[],
  ownUserId: string,
): ReactionGroup[] {
  const groups = new Map<string, { emoji: string; count: number; mine: boolean }>();
  for (const reaction of reactions) {
    const group = groups.get(reaction.emoji) ?? { emoji: reaction.emoji, count: 0, mine: false };
    group.count += 1;
    group.mine = group.mine || reaction.userId === ownUserId;
    groups.set(reaction.emoji, group);
  }
  return [...groups.values()];
}

/**
 * Groups a batched reactions page (one row per reaction, keyed by message) into
 * per-message emoji groups, so the timeline can render every row from one
 * subscription instead of one query per message.
 */
export function groupReactionsByMessage(
  rows: readonly { readonly messageId: string; readonly userId: string; readonly emoji: string }[],
  ownUserId: string,
): Map<string, readonly ReactionGroup[]> {
  const byMessage = new Map<string, { userId: string; emoji: string }[]>();
  for (const row of rows) {
    const list = byMessage.get(row.messageId);
    if (list === undefined) {
      byMessage.set(row.messageId, [{ userId: row.userId, emoji: row.emoji }]);
    } else {
      list.push({ userId: row.userId, emoji: row.emoji });
    }
  }
  const grouped = new Map<string, readonly ReactionGroup[]>();
  for (const [messageId, list] of byMessage) {
    grouped.set(messageId, groupReactions(list, ownUserId));
  }
  return grouped;
}
