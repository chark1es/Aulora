import type { MessagePayload } from "@aulora/core";
import { useEffect, useRef } from "react";
import type { ChatRuntime } from "./chat-runtime";
import { isDesktop, showDesktopNotification } from "./desktop";

/** How much decrypted text a native notification may carry. */
const NOTIFICATION_BODY_LIMIT = 240;

/**
 * Desktop-only integration for incoming messages: a native notification when
 * the window is unfocused. The notification body is the decrypted message
 * text, computed on this device, never sent to the server. Messages that
 * predate mount are ignored so opening the app does not replay history as
 * notifications. The unread badge is owned by {@link useLiveUnreadBadge}, which
 * reads live read cursors.
 */
export function useDesktopNotifications(
  runtime: ChatRuntime | undefined,
  ownUserId: string,
  channelNames: ReadonlyMap<string, string>,
): void {
  const namesRef = useRef(channelNames);
  namesRef.current = channelNames;

  useEffect(() => {
    if (!isDesktop() || runtime === undefined) {
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
        if (text === undefined || text.trim().length === 0) {
          continue;
        }
        if (!document.hasFocus()) {
          const channelName = namesRef.current.get(message.channelId);
          const title = channelName === undefined ? "New message" : `#${channelName}`;
          void showDesktopNotification(title, text.slice(0, NOTIFICATION_BODY_LIMIT));
        }
      }
    });

    return () => {
      offDecrypted();
    };
  }, [runtime, ownUserId]);
}
