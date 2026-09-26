import type { MessagePayload } from "@aulora/core";
import { useEffect, useRef } from "react";
import type { ChatRuntime } from "./chat-runtime";
import { isDesktop, setDesktopUnreadBadge, showDesktopNotification } from "./desktop";

/** How much decrypted text a native notification may carry. */
const NOTIFICATION_BODY_LIMIT = 240;

/**
 * Desktop-only integration for incoming messages: a native notification when
 * the window is unfocused and a Dock/taskbar unread badge. The notification
 * body is the decrypted message text, computed on this device, never sent to
 * the server. Messages that predate mount are ignored so opening the app does
 * not replay history as notifications.
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
    let unread = 0;

    const offDecrypted = runtime.session.onDecrypted((messages: readonly MessagePayload[]) => {
      if (!seeded) {
        seeded = true;
        for (const message of messages) {
          seen.add(message.id);
        }
        return;
      }
      let added = 0;
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
        added += 1;
        if (!document.hasFocus()) {
          const channelName = namesRef.current.get(message.channelId);
          const title = channelName === undefined ? "New message" : `#${channelName}`;
          void showDesktopNotification(title, text.slice(0, NOTIFICATION_BODY_LIMIT));
        }
      }
      if (added > 0) {
        unread += added;
        void setDesktopUnreadBadge(unread);
      }
    });

    const clearBadge = () => {
      unread = 0;
      void setDesktopUnreadBadge(0);
    };
    window.addEventListener("focus", clearBadge);
    return () => {
      offDecrypted();
      window.removeEventListener("focus", clearBadge);
      void setDesktopUnreadBadge(0);
    };
  }, [runtime, ownUserId]);
}
