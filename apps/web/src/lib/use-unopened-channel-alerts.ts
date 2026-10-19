import { useEffect, useRef } from "react";
import type { ChannelUnreadState } from "./channel-priority";
import { playSound } from "./sounds";
import { showUnfocusedNotification } from "./use-desktop-notifications";

export interface UnopenedChannelAlertsOptions {
  /** Per-channel unread/mention state, already subscribed for the sidebar. */
  readonly unreadByChannel: ReadonlyMap<string, ChannelUnreadState>;
  /** Channels whose message streams are already open (alerts fire via them). */
  readonly eagerChannelIds: ReadonlySet<string>;
  /** The open conversation, served by `useChannelSession`. */
  readonly activeChannelId: string | undefined;
  readonly mutedChannelIds: ReadonlySet<string>;
  readonly channelNames: ReadonlyMap<string, string>;
}

/**
 * Chimes and raises an OS notification for new activity in conversations whose
 * message streams are *not* open, using the already-subscribed
 * `readStates.summary` (the same data the sidebar badges read). Without this,
 * bounding the eager open set (W1) would silence alerts for every channel past
 * the cap.
 *
 * Only the fact that a channel gained unread messages or mentions is known here
 * — the body stays on the server — so the notification is generic. Channels
 * that are eagerly open, currently open, or muted are skipped, and the first
 * snapshot seeds from the current state so signing in never replays history.
 */
export function useUnopenedChannelAlerts(options: UnopenedChannelAlertsOptions): void {
  const previous = useRef<ReadonlyMap<string, ChannelUnreadState> | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: diff on the snapshot only
  useEffect(() => {
    const current = options.unreadByChannel;
    const before = previous.current;
    previous.current = current;
    if (before === null) {
      return;
    }
    for (const [channelId, now] of current) {
      if (
        options.eagerChannelIds.has(channelId) ||
        channelId === options.activeChannelId ||
        options.mutedChannelIds.has(channelId)
      ) {
        continue;
      }
      const then = before.get(channelId);
      const mentionUp = now.mentionCount > (then?.mentionCount ?? 0);
      const activityUp =
        now.lastActivityAt !== null && now.lastActivityAt > (then?.lastActivityAt ?? 0);
      if (!mentionUp && !(now.unread && activityUp)) {
        continue;
      }
      playSound(mentionUp ? "mention" : "message");
      if (!document.hasFocus()) {
        const name = options.channelNames.get(channelId);
        showUnfocusedNotification(
          mentionUp
            ? `Mentioned in ${name === undefined ? "a channel" : `#${name}`}`
            : name === undefined
              ? "New message"
              : `#${name}`,
          "You have new messages in a conversation you are not viewing.",
        );
      }
    }
  }, [options.unreadByChannel]);
}
