import type { MessagePayload } from "@aulora/core";
import { useEffect, useRef } from "react";
import type { ChatRuntime } from "./chat-runtime";
import { isDesktop, showDesktopNotification } from "./desktop";

/** How much message text a native notification may carry. */
const NOTIFICATION_BODY_LIMIT = 240;

const NO_MUTES: ReadonlySet<string> = new Set();

/**
 * Shows an OS notification when the window is not focused: the native shell
 * notification on desktop, or the browser Notification API on the web when the
 * user has granted permission. Best-effort; never blocks the message pipeline.
 */
export function showUnfocusedNotification(title: string, body: string): void {
  if (isDesktop()) {
    void showDesktopNotification(title, body);
    return;
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return;
  }
  try {
    new Notification(title, { body });
  } catch {
    // Notifications are best-effort.
  }
}

/**
 * Incoming message notifications: an OS notification when the window is
 * unfocused, on web and desktop alike. The notification body is the message
 * text the server returned to this device; messages that predate mount are
 * ignored so opening the app does not replay history. The unread badge is owned
 * by {@link useLiveUnreadBadge}, which reads live read cursors.
 */
export function useDesktopNotifications(
  runtime: ChatRuntime | undefined,
  ownUserId: string,
  channelNames: ReadonlyMap<string, string>,
  mutedChannelIds: ReadonlySet<string> = NO_MUTES,
): void {
  const namesRef = useRef(channelNames);
  namesRef.current = channelNames;
  const mutedRef = useRef(mutedChannelIds);
  mutedRef.current = mutedChannelIds;

  useEffect(() => {
    if (runtime === undefined) {
      return;
    }
    const mountedAt = Date.now();
    const seen = new Set<string>();
    let seeded = false;

    const offDecrypted = runtime.session.onDecrypted((messages: readonly MessagePayload[]) => {
      if (!seeded) {
        seeded = true;
        for (const message of messages) {
          seen.add(message.id);
        }
        return;
      }
      for (const message of messages) {
        if (seen.has(message.id)) {
          continue;
        }
        seen.add(message.id);
        if (message.authorId === ownUserId || message.createdAt < mountedAt) {
          continue;
        }
        const text = runtime.session.decryptedText(message.id);
        if (text.trim().length === 0) {
          continue;
        }
        // Muted channels never raise an OS notification, mention or not.
        if (mutedRef.current.has(message.channelId)) {
          continue;
        }
        if (!document.hasFocus()) {
          const channelName = namesRef.current.get(message.channelId);
          const mentioned = message.mentionUserIds.includes(ownUserId);
          const title = mentioned
            ? `Mentioned in ${channelName === undefined ? "a channel" : `#${channelName}`}`
            : channelName === undefined
              ? "New message"
              : `#${channelName}`;
          showUnfocusedNotification(title, text.slice(0, NOTIFICATION_BODY_LIMIT));
        }
      }
    });

    return () => {
      offDecrypted();
    };
  }, [runtime, ownUserId]);
}
