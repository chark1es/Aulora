import { badgeCount } from "@aulora/core";

/** The unread rollup for a conversation row, as served by `readStates.summary`. */
export interface RowUnread {
  readonly unread: boolean;
  readonly unreadCount: number;
  readonly mentionCount: number;
}

/**
 * The spoken name for a conversation row: the title first, then the state a
 * sighted user reads from weight, a dot or a count. Selection is announced by
 * the row itself through `accessibilityState`, not repeated here.
 */
export function rowAccessibilityLabel(
  title: string,
  unread: RowUnread | undefined,
  muted: boolean,
): string {
  const mutedLabel = muted ? ", muted" : "";
  const unreadLabel = unread?.unread === true ? ", unread" : "";
  const count = badgeCount(unread?.mentionCount ?? 0);
  const mentionLabel = count === null ? "" : `, ${count} ${count === "1" ? "mention" : "mentions"}`;
  return `${title}${mutedLabel}${unreadLabel}${mentionLabel}`;
}
