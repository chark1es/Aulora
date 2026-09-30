/**
 * Presentation helpers shared by the web and native message lists: local-day
 * separators, author runs ("grouped" consecutive messages), the unread divider,
 * conversation titles and the typing line. Pure functions, so both renderers
 * lay out a conversation identically and the rules are unit-tested once.
 */

import type { ChannelSummary, MessagePayload, TypingRow } from "./port.js";

/** Consecutive messages by one author closer than this share one header. */
export const GROUP_WINDOW_MS = 5 * 60_000;

const DAY_MS = 86_400_000;

export type TimelineItem =
  | { readonly kind: "day"; readonly key: string; readonly dayStart: number }
  | { readonly kind: "unread"; readonly key: string }
  | {
      readonly kind: "message";
      readonly key: string;
      readonly message: MessagePayload;
      /** First message of an author run: render the avatar and name. */
      readonly startsGroup: boolean;
      /** Last message of an author run: render the tail / trailing spacing. */
      readonly endsGroup: boolean;
    };

export interface TimelineOptions {
  /** Message id the "New messages" divider is drawn above, if any. */
  readonly firstUnreadId?: string | null;
  readonly groupWindowMs?: number;
}

/** Midnight of the local calendar day containing `timestamp`. */
export function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Flattens messages (oldest first) into render items: a day separator at each
 * local-day boundary, an unread divider above `firstUnreadId`, and messages
 * tagged with where their author run starts and ends. A run breaks on a new
 * author, a day boundary, the unread divider, a gap over the group window, or
 * a deleted message (tombstones always stand alone). Inline replies always
 * start a new run so their author and reply context remain visible.
 */
export function buildTimeline(
  messages: readonly MessagePayload[],
  options: TimelineOptions = {},
): TimelineItem[] {
  const windowMs = options.groupWindowMs ?? GROUP_WINDOW_MS;
  const items: TimelineItem[] = [];
  let previous: MessagePayload | undefined;
  let currentDay: number | undefined;

  for (const message of messages) {
    let startsGroup =
      previous === undefined ||
      previous.authorId !== message.authorId ||
      message.createdAt - previous.createdAt > windowMs ||
      message.replyToId != null ||
      previous.deletedAt !== null ||
      message.deletedAt !== null;
    const day = startOfLocalDay(message.createdAt);
    if (day !== currentDay) {
      items.push({ kind: "day", key: `day:${day}`, dayStart: day });
      currentDay = day;
      startsGroup = true;
    }
    if (options.firstUnreadId != null && message.id === options.firstUnreadId) {
      items.push({ kind: "unread", key: `unread:${message.id}` });
      startsGroup = true;
    }
    items.push({ kind: "message", key: message.id, message, startsGroup, endsGroup: true });
    previous = message;
  }

  // A message ends its run unless the very next item continues that run.
  return items.map((item, index) => {
    const next = items[index + 1];
    if (item.kind === "message" && next?.kind === "message" && !next.startsGroup) {
      return { ...item, endsGroup: false };
    }
    return item;
  });
}

/** "Today", "Yesterday", a weekday within the last week, else a date. */
export function dayLabel(dayStart: number, now: number = Date.now()): string {
  const today = startOfLocalDay(now);
  const diffDays = Math.round((today - startOfLocalDay(dayStart)) / DAY_MS);
  if (diffDays === 0) {
    return "Today";
  }
  if (diffDays === 1) {
    return "Yesterday";
  }
  const date = new Date(dayStart);
  if (diffDays > 1 && diffDays < 7) {
    return date.toLocaleDateString(undefined, { weekday: "long" });
  }
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Short clock time for a message, in the viewer's locale. */
export function messageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Compact activity stamp for conversation rows: "now", "5m", "3h", a weekday
 * within the week, else a short date.
 */
export function activityLabel(timestamp: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  if (diff < 60_000) {
    return "now";
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)}m`;
  }
  if (startOfLocalDay(timestamp) === startOfLocalDay(now)) {
    return `${Math.floor(diff / 3_600_000)}h`;
  }
  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(timestamp)) / DAY_MS);
  const date = new Date(timestamp);
  if (days < 7) {
    return date.toLocaleDateString(undefined, { weekday: "short" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Badge text for a count: hidden at zero, capped at "99+". */
export function badgeCount(count: number): string | null {
  if (count <= 0) {
    return null;
  }
  return count > 99 ? "99+" : String(count);
}

/**
 * Display title for a conversation. Channels use their decrypted name; DMs and
 * group DMs are named after the other participants, since their names are
 * never encrypted into the channel.
 */
export function conversationTitle(
  channel: Pick<ChannelSummary, "kind" | "memberIds"> & { readonly name: string },
  ownUserId: string,
  nameOf: (userId: string) => string | undefined,
): string {
  if (channel.kind !== "dm" && channel.kind !== "group_dm") {
    return channel.name;
  }
  const others = (channel.memberIds ?? []).filter((userId) => userId !== ownUserId);
  const names = others.map((userId) => nameOf(userId) ?? "Unknown member");
  if (names.length === 0) {
    return channel.kind === "dm" && (channel.memberIds ?? []).length > 0
      ? "Notes to self"
      : channel.name;
  }
  if (names.length <= 3) {
    return names.join(", ");
  }
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`;
}

/** The other participant of a 1:1 DM, if any; used for its avatar and presence. */
export function dmPartnerId(
  channel: Pick<ChannelSummary, "kind" | "memberIds">,
  ownUserId: string,
): string | undefined {
  if (channel.kind !== "dm") {
    return undefined;
  }
  return (channel.memberIds ?? []).find((userId) => userId !== ownUserId);
}

/** Typers other than the viewer whose rows have not expired, in list order. */
export function activeTypers(
  typers: readonly TypingRow[],
  ownUserId: string,
  now: number = Date.now(),
): TypingRow[] {
  return typers.filter((typer) => typer.expiresAt > now && typer.userId !== ownUserId);
}

/**
 * The "who is typing" line: expired rows and the viewer are ignored; returns
 * `null` when nobody else is typing.
 */
export function typingLabel(
  typers: readonly TypingRow[],
  ownUserId: string,
  nameOf: (userId: string) => string,
  now: number = Date.now(),
): string | null {
  const active = activeTypers(typers, ownUserId, now);
  if (active.length === 0) {
    return null;
  }
  const names = active.map((typer) => nameOf(typer.userId));
  if (names.length === 1) {
    return `${names[0]} is typing…`;
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]} are typing…`;
  }
  return `${names.length} people are typing…`;
}

/** Minimum gap between typing heartbeats sent to the server. */
export const TYPING_THROTTLE_MS = 3_000;

/**
 * Throttles typing heartbeats per channel so a keystroke burst sends one
 * mutation, not one per key. `reset` is called on send so the next keystroke
 * re-announces immediately.
 */
export function createTypingThrottle(
  send: (channelId: string) => void,
  intervalMs: number = TYPING_THROTTLE_MS,
  clock: () => number = Date.now,
): { ping(channelId: string): void; reset(channelId: string): void } {
  const lastSent = new Map<string, number>();
  return {
    ping(channelId) {
      const now = clock();
      const last = lastSent.get(channelId);
      if (last !== undefined && now - last < intervalMs) {
        return;
      }
      lastSent.set(channelId, now);
      send(channelId);
    },
    reset(channelId) {
      lastSent.delete(channelId);
    },
  };
}
