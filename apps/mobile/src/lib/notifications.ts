import type { CallView, MessagePayload, SoundEvent } from "@aulora/core";
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import type { MobileChatRuntime } from "./chat-runtime";
import { notificationContent, shouldNotify } from "./notifications-format";
import { CALL_CHANNEL_ID } from "./push";

export interface LocalNotificationOptions {
  /** Channels the viewer muted: never cue or notify for them. */
  readonly mutedChannelIds?: ReadonlySet<string>;
  /** Plays the device sound cue for a message or mention. */
  readonly onCue?: (event: SoundEvent) => void;
}

/**
 * Local display of incoming messages. The server holds message bodies only
 * sealed at rest and returns them to this device; opening the app does not
 * replay history. The body shown is the message text for this device.
 */
export function useLocalNotifications(
  runtime: MobileChatRuntime | undefined,
  ownUserId: string,
  channelNames: ReadonlyMap<string, string>,
  options: LocalNotificationOptions = {},
): void {
  const namesRef = useRef(channelNames);
  namesRef.current = channelNames;
  const optionsRef = useRef(options);
  optionsRef.current = options;

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
        if (optionsRef.current.mutedChannelIds?.has(message.channelId) === true) {
          continue;
        }
        const mentioned = message.mentionUserIds.includes(ownUserId);
        optionsRef.current.onCue?.(mentioned ? "mention" : "message");
        added += 1;
        const content = notificationContent(namesRef.current.get(message.channelId), text, {
          mention: mentioned,
        });
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

/**
 * Raises a local notification for an incoming call when the app is not in the
 * foreground. In-app ringing is handled by {@link IncomingCallModal}; this is
 * the backgrounded-device path (push wakes are handled server-side).
 */
export function useIncomingCallNotification(
  incoming: readonly CallView[],
  callerName: (call: CallView) => string,
): void {
  const announced = useRef(new Set<string>());
  useEffect(() => {
    for (const call of incoming) {
      if (announced.current.has(call.id)) {
        continue;
      }
      announced.current.add(call.id);
      if (AppState.currentState === "active") {
        continue;
      }
      void Notifications.scheduleNotificationAsync({
        content: {
          title: `Incoming call from ${callerName(call)}`,
          body: call.kind === "video" ? "Video call" : "Voice call",
          sound: "default",
          // Lets the notification handler ring for calls (and only calls).
          data: { kind: "call", callId: call.id },
          ...(Platform.OS === "android" ? { channelId: CALL_CHANNEL_ID } : {}),
          ...(Platform.OS === "android"
            ? { priority: Notifications.AndroidNotificationPriority.MAX }
            : {}),
        },
        trigger: null,
      });
    }
  }, [incoming, callerName]);
}
