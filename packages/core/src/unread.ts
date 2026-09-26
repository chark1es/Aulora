/** Minimal message metadata needed for unread math. Never contains plaintext. */
export interface MessageMeta {
  readonly id: string;
  readonly createdAt: number;
  readonly authorId?: string;
  /** Plaintext mention ids by design so the server can route notifications. */
  readonly mentionedUserIds?: readonly string[];
}

export interface ReadCursor {
  readonly lastReadAt: number | null;
  readonly lastReadMessageId: string | null;
  readonly mentionCount: number;
}

export interface UnreadSummary {
  readonly unread: boolean;
  readonly unreadCount: number;
  readonly mentionCount: number;
  readonly firstUnreadId: string | null;
}

export const EMPTY_CURSOR: ReadCursor = {
  lastReadAt: null,
  lastReadMessageId: null,
  mentionCount: 0,
};

export function emptyCursor(): ReadCursor {
  return { ...EMPTY_CURSOR };
}

/** A message is read if it is the cursor message or at/before the cursor time. */
export function isMessageRead(cursor: ReadCursor, message: MessageMeta): boolean {
  if (cursor.lastReadMessageId !== null && cursor.lastReadMessageId === message.id) {
    return true;
  }
  return cursor.lastReadAt !== null && message.createdAt <= cursor.lastReadAt;
}

/** Messages must be ascending by `createdAt` (the Convex channel order). */
export function firstUnreadMessage(
  messages: readonly MessageMeta[],
  cursor: ReadCursor,
): MessageMeta | undefined {
  return messages.find((message) => !isMessageRead(cursor, message));
}

export function countUnread(messages: readonly MessageMeta[], cursor: ReadCursor): number {
  let count = 0;
  for (const message of messages) {
    if (!isMessageRead(cursor, message)) {
      count += 1;
    }
  }
  return count;
}

export function countMentions(
  messages: readonly MessageMeta[],
  cursor: ReadCursor,
  userId: string,
): number {
  let count = 0;
  for (const message of messages) {
    if (isMessageRead(cursor, message)) {
      continue;
    }
    if (message.mentionedUserIds?.includes(userId) === true) {
      count += 1;
    }
  }
  return count;
}

/** Compares the read cursor against the latest message in the channel. */
export function hasUnread(cursor: ReadCursor, latestMessage: MessageMeta | null): boolean {
  if (latestMessage === null) {
    return false;
  }
  return !isMessageRead(cursor, latestMessage);
}

export function summarizeUnread(
  messages: readonly MessageMeta[],
  cursor: ReadCursor,
  userId: string,
): UnreadSummary {
  const first = firstUnreadMessage(messages, cursor);
  const unreadCount = first === undefined ? 0 : countUnread(messages, cursor);
  const mentionCount = first === undefined ? 0 : countMentions(messages, cursor, userId);
  return {
    unread: first !== undefined,
    unreadCount,
    mentionCount,
    firstUnreadId: first?.id ?? null,
  };
}

/**
 * Moves the cursor forward to a fully-read message and clears the stored
 * mention count. Passing an already-read (older) message is a no-op.
 */
export function advanceCursor(cursor: ReadCursor, message: MessageMeta): ReadCursor {
  if (isMessageRead(cursor, message)) {
    return cursor;
  }
  const lastReadAt =
    cursor.lastReadAt === null ? message.createdAt : Math.max(cursor.lastReadAt, message.createdAt);
  return {
    lastReadAt,
    lastReadMessageId: message.id,
    mentionCount: 0,
  };
}
