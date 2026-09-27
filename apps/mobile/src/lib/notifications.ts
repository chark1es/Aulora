import type { MessagePayload } from "@aulora/core";
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import type { MobileChatRuntime } from "./chat-runtime";
import { notificationContent, shouldNotify } from "./notifications-format";

/**
 * Local display of incoming messages. The server holds message bodies only
 * sealed at rest and returns them to this device; opening the app does not
 * replay history. The body shown is the message text for this device.
 */
export function useLocalNotifications(
  runtime: MobileChatRuntime | undefined,
  ownUserId: string,
  channelNames: ReadonlyMap<string, string>,
): void {
  const namesRef = useRef(channelNames);
  namesRef.current = channelNames;

  useEffect(() => {
    if (runtime === undefined) {
      return;
    }
    const mountedAt = Date.now();
    const seen = new Set<string>();
    let seeded = false;
    let unread = 0;

    const off = runtime.session.onDecrypted((messages: readonly MessagePayload[]) => {
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
        const text = runtime.session.decryptedText(message.id);
        if (
          !shouldNotify(
            {
              id: message.id,
              authorId: message.authorId,
              createdAt: message.createdAt,
              text,
            },
            ownUserId,
            mountedAt,
          )
        ) {
          continue;
        }
        added += 1;
        const content = notificationContent(namesRef.current.get(message.channelId), text);
        void Notifications.scheduleNotificationAsync({
          content: { title: content.title, body: content.body },
          trigger: null,
        });
      }
      if (added > 0) {
        unread += added;
        void Notifications.setBadgeCountAsync(unread);
      }
    });

    return () => {
      off();
      void Notifications.setBadgeCountAsync(0);
    };
  }, [runtime, ownUserId]);
}
