import { dayLabel, GROUP_WINDOW_MS, type MessagePayload, startOfLocalDay } from "@aulora/core";

/** One entry of the message list: a day separator or a message. */
export type MessageListRow =
  | { readonly kind: "day"; readonly key: string; readonly label: string }
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
    previous.authorId === message.authorId &&
    previous.deletedAt === null &&
    message.createdAt - previous.createdAt < GROUP_WINDOW_MS &&
    (message.replyToId === null || message.replyToId === undefined)
  );
}

/**
 * Turns messages in chronological order into list rows, newest first, because
 * the list is inverted so it opens on the latest message. A day separator
 * follows the messages of its day in the array, so it draws above them.
 */
export function buildMessageRows(messages: readonly MessagePayload[]): MessageListRow[] {
  const rows: MessageListRow[] = [];
  messages.forEach((message, index) => {
    const previous = messages[index - 1];
    const day = startOfLocalDay(message.createdAt);
    const sameDay = previous !== undefined && startOfLocalDay(previous.createdAt) === day;
    if (!sameDay) rows.push({ kind: "day", key: `day-${day}`, label: dayLabel(day) });
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
