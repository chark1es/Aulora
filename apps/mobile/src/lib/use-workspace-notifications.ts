import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useProfiles } from "../providers/ProfileProvider";
import {
  clearWorkspaceUnread,
  profileForServerId,
  readWorkspaceNotificationHint,
  recordWorkspaceUnread,
  setWorkspaceNotificationTarget,
  subscribeWorkspaceUnread,
  workspaceUnreadSnapshot,
} from "./workspace-notifications";

/** Notification ids already counted/taken, bounded so a long install stays small. */
function remember(seen: Set<string>, id: string): boolean {
  if (seen.has(id)) {
    return false;
  }
  if (seen.size >= 64) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) {
      seen.delete(oldest);
    }
  }
  seen.add(id);
  return true;
}

const received = new Set<string>();
const opened = new Set<string>();

/** Live badge counts for workspaces other than the open one. */
export function useWorkspaceUnreadCounts(): ReadonlyMap<string, number> {
  return useSyncExternalStore(
    subscribeWorkspaceUnread,
    workspaceUnreadSnapshot,
    workspaceUnreadSnapshot,
  );
}

/**
 * Bridges OS notifications to the workspace switcher. A wake for a workspace
 * that is not open raises its nav badge; opening the notification switches to
 * that workspace and lands in the conversation it names.
 *
 * Mounted once under `ProfileProvider`; the relay's wake carries only opaque
 * ids, so nothing here learns a sender or message body.
 */
export function useWorkspaceNotifications(): void {
  const { profiles, activeProfile, setActive } = useProfiles();
  const router = useRouter();
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const activeIdRef = useRef(activeProfile?.id);
  activeIdRef.current = activeProfile?.id;

  useEffect(() => {
    const handle = (notification: Notifications.Notification, isOpen: boolean) => {
      const request = notification.request;
      const seen = isOpen ? opened : received;
      if (!remember(seen, request.identifier)) {
        return;
      }
      const hint = readWorkspaceNotificationHint(request.content.data);
      if (hint === null) {
        return;
      }
      const profile = profileForServerId(profilesRef.current, hint.serverId);
      if (profile === undefined) {
        return;
      }
      if (!isOpen) {
        if (activeIdRef.current !== profile.id) {
          recordWorkspaceUnread(profile.id);
        }
        return;
      }
      clearWorkspaceUnread(profile.id);
      setWorkspaceNotificationTarget(profile.id, hint.channelId);
      if (activeIdRef.current === profile.id) {
        return;
      }
      void setActive(profile.id)
        .then(() => {
          void router.replace("/");
        })
        .catch(() => undefined);
    };

    const onReceived = Notifications.addNotificationReceivedListener((notification) => {
      handle(notification, false);
    });
    const onResponse = Notifications.addNotificationResponseReceivedListener((response) => {
      handle(response.notification, true);
    });
    // A notification that launched the app arrives before any listener attached.
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response !== null) {
          handle(response.notification, true);
        }
      })
      .catch(() => undefined);

    return () => {
      onReceived.remove();
      onResponse.remove();
    };
  }, [router, setActive]);
}
