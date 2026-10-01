import { describe, expect, it } from "vitest";
import {
  advanceCursor,
  countMentions,
  countUnread,
  EMPTY_CURSOR,
  emptyCursor,
  firstUnreadMessage,
  hasUnread,
  isMessageRead,
  type MessageMeta,
  summarizeUnread,
} from "../src/unread";

const m1: MessageMeta = { id: "m1", createdAt: 100, authorId: "bob" };
const m2: MessageMeta = { id: "m2", createdAt: 200, authorId: "bob", mentionedUserIds: ["alice"] };
const m3: MessageMeta = { id: "m3", createdAt: 300, authorId: "carol", mentionedUserIds: ["bob"] };
const MESSAGES = [m1, m2, m3];

const cursorAt = (message: MessageMeta) => ({
  lastReadAt: message.createdAt,
  lastReadMessageId: message.id,
  mentionCount: 0,
});

describe("read cursor", () => {
  it("treats a message as read at or before the cursor time", () => {
    const cursor = cursorAt(m1);
    expect(isMessageRead(cursor, m1)).toBe(true);
    expect(isMessageRead(cursor, m2)).toBe(false);
    expect(isMessageRead(cursor, m3)).toBe(false);
  });

  it("treats a cursor message as read even without a timestamp", () => {
    const cursor = { lastReadAt: null, lastReadMessageId: "m2", mentionCount: 0 };
    expect(isMessageRead(cursor, m2)).toBe(true);
    expect(isMessageRead(cursor, m1)).toBe(false);
  });

  it("treats everything as unread for an empty cursor", () => {
    for (const message of MESSAGES) {
      expect(isMessageRead(EMPTY_CURSOR, message)).toBe(false);
    }
    expect(countUnread(MESSAGES, EMPTY_CURSOR)).toBe(3);
  });

  it("emptyCursor returns a fresh copy", () => {
    expect(emptyCursor()).toEqual(EMPTY_CURSOR);
    expect(emptyCursor()).not.toBe(EMPTY_CURSOR);
  });
});

describe("unread summary", () => {
  it("finds the first unread message and counts the tail", () => {
    const cursor = cursorAt(m1);
    expect(firstUnreadMessage(MESSAGES, cursor)?.id).toBe("m2");
    expect(countUnread(MESSAGES, cursor)).toBe(2);
  });

  it("reports no unread once the cursor is at the latest message", () => {
    const cursor = cursorAt(m3);
    expect(firstUnreadMessage(MESSAGES, cursor)).toBeUndefined();
    expect(countUnread(MESSAGES, cursor)).toBe(0);
    expect(hasUnread(cursor, m3)).toBe(false);
  });

  it("resolves an id-only cursor so earlier messages stay read", () => {
    const cursor = { lastReadAt: null, lastReadMessageId: "m3", mentionCount: 0 };
    expect(summarizeUnread(MESSAGES, cursor, "alice")).toEqual({
      unread: false,
      unreadCount: 0,
      mentionCount: 0,
      firstUnreadId: null,
    });
  });

  it("counts only messages and mentions after an id-only cursor", () => {
    const cursor = { lastReadAt: null, lastReadMessageId: "m2", mentionCount: 0 };
    expect(summarizeUnread(MESSAGES, cursor, "bob")).toEqual({
      unread: true,
      unreadCount: 1,
      mentionCount: 1,
      firstUnreadId: "m3",
    });
  });

  it("uses a supplied cursor timestamp when its message is outside the loaded page", () => {
    expect(summarizeUnread([m3], cursorAt(m2), "bob")).toEqual({
      unread: true,
      unreadCount: 1,
      mentionCount: 1,
      firstUnreadId: "m3",
    });
  });

  it("keeps loaded messages unread when an id-only cursor is outside the page", () => {
    const cursor = { lastReadAt: null, lastReadMessageId: "older-message", mentionCount: 0 };
    expect(summarizeUnread(MESSAGES, cursor, "alice")).toEqual({
      unread: true,
      unreadCount: 3,
      mentionCount: 1,
      firstUnreadId: "m1",
    });
  });

  it("compares the cursor with the latest message", () => {
    expect(hasUnread(cursorAt(m1), m3)).toBe(true);
    expect(hasUnread(EMPTY_CURSOR, m3)).toBe(true);
    expect(hasUnread(EMPTY_CURSOR, null)).toBe(false);
  });

  it("counts mentions only for the unread tail and only for this user", () => {
    const cursor = cursorAt(m1);
    expect(countMentions(MESSAGES, cursor, "alice")).toBe(1);
    expect(countMentions(MESSAGES, cursor, "bob")).toBe(1);
    expect(countMentions(MESSAGES, cursor, "carol")).toBe(0);
    expect(countMentions(MESSAGES, EMPTY_CURSOR, "bob")).toBe(1);
    expect(countMentions(MESSAGES, cursorAt(m3), "alice")).toBe(0);
  });

  it("summarizes unread state for a channel", () => {
    expect(summarizeUnread(MESSAGES, cursorAt(m1), "alice")).toEqual({
      unread: true,
      unreadCount: 2,
      mentionCount: 1,
      firstUnreadId: "m2",
    });
    expect(summarizeUnread(MESSAGES, cursorAt(m3), "alice")).toEqual({
      unread: false,
      unreadCount: 0,
      mentionCount: 0,
      firstUnreadId: null,
    });
  });

  it("handles an empty channel", () => {
    expect(summarizeUnread([], EMPTY_CURSOR, "alice")).toEqual({
      unread: false,
      unreadCount: 0,
      mentionCount: 0,
      firstUnreadId: null,
    });
    expect(hasUnread(EMPTY_CURSOR, null)).toBe(false);
  });
});

describe("advanceCursor", () => {
  it("moves the cursor to a newer message and clears mentions", () => {
    const before = { lastReadAt: 100, lastReadMessageId: "m1", mentionCount: 4 };
    expect(advanceCursor(before, m3)).toEqual({
      lastReadAt: 300,
      lastReadMessageId: "m3",
      mentionCount: 0,
    });
  });

  it("is a no-op for an already-read message", () => {
    const cursor = cursorAt(m3);
    expect(advanceCursor(cursor, m1)).toBe(cursor);
    expect(advanceCursor(cursor, m3)).toBe(cursor);
  });

  it("advances from an empty cursor", () => {
    expect(advanceCursor(EMPTY_CURSOR, m2)).toEqual({
      lastReadAt: 200,
      lastReadMessageId: "m2",
      mentionCount: 0,
    });
  });
});
