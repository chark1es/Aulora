import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useProfiles } from "../providers/ProfileProvider";
import {
  backfillWorkspaceServerId,
  clearWorkspaceUnread,
  ensureWorkspaceNotificationsLoaded,
  profileForServerId,
  readWorkspaceNotificationHint,
  recordWorkspaceUnread,
  resolveWorkspaceProfile,
  setWorkspaceNotificationTarget,
  subscribeWorkspaceUnread,
  workspaceServerIdForProfile,
  workspaceUnreadSnapshot,
} from "./workspace-identity";

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

type WakeMode = "received" | "opened";

/**
 * Bridges OS notifications to the workspace switcher. A wake for a workspace
 * that is not open raises its nav badge; opening it (or receiving it while the
 * app is already running) switches to that workspace and lands in the exact
 * conversation and message it names.
 *
 * Mounted once under `ProfileProvider`; the relay's wake carries only opaque
 * ids, so nothing here learns a sender or message body.
 */
export function useWorkspaceNotifications(): void {
  const { profiles, activeProfile, ready, setActive } = useProfiles();
  const router = useRouter();
  const activeIdRef = useRef(activeProfile?.id);
  activeIdRef.current = activeProfile?.id;
  const pendingOpen = useRef<Notifications.Notification | null>(null);

  // Learn each saved workspace's advertised wake id. New profiles get it at
  // connect time; this backfills profiles saved by an older build, so a wake
  // that names an opaque AULORA_SERVER_ID still resolves after a cold start.
  useEffect(() => {
    if (!ready) {
      return;
    }
    let cancelled = false;
    const missing = profiles
      .filter((profile) => workspaceServerIdForProfile(profile.id) === undefined)
      .slice(0, 4);
    if (missing.length === 0) {
      return;
    }
    void (async () => {
      for (const profile of missing) {
        if (cancelled) {
          return;
        }
        await backfillWorkspaceServerId(profile).catch(() => null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, profiles]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    let cancelled = false;

    const handle = async (notification: Notifications.Notification, mode: WakeMode) => {
      const request = notification.request;
      const seen = mode === "opened" ? opened : received;
      if (!remember(seen, request.identifier)) {
        return;
      }
      const hint = readWorkspaceNotificationHint(request.content.data);
      if (hint === null) {
        return;
      }
      await ensureWorkspaceNotificationsLoaded();
      if (cancelled) {
        return;
      }
      const profile =
        profileForServerId(profiles, hint.serverId) ??
        (await resolveWorkspaceProfile(profiles, hint.serverId).catch(() => undefined));
      if (profile === undefined || cancelled) {
        // Profiles may hydrate after the launch response. Keep the wake and
        // retry on the next effect run instead of dropping the tap.
        if (mode === "opened") {
          pendingOpen.current = notification;
        }
        return;
      }

      const apply = () => {
        setWorkspaceNotificationTarget(profile.id, hint.channelId, hint.messageId, hint.kind);
      };

      if (mode === "opened") {
        clearWorkspaceUnread(profile.id);
        apply();
        if (activeIdRef.current === profile.id) {
          return;
        }
        try {
          await setActive(profile.id);
          if (!cancelled) {
            router.replace("/");
          }
        } catch {
          // A refused write leaves the current workspace active; the pending
          // target stays for the next successful switch.
        }
        return;
      }

      // A wake for a workspace that is not open: badge it, then move to it so
      // the person lands on the new message rather than having to tap twice.
      if (activeIdRef.current === profile.id) {
        return;
      }
      recordWorkspaceUnread(profile.id);
      apply();
      try {
        await setActive(profile.id);
        if (cancelled) {
          return;
        }
        clearWorkspaceUnread(profile.id);
        router.replace("/");
      } catch {
        // Keep the badge; the switcher still exposes the workspace.
      }
    };

    const flushPending = () => {
      const pending = pendingOpen.current;
      if (pending !== null) {
        pendingOpen.current = null;
        void handle(pending, "opened");
      }
    };
    flushPending();

    const onReceived = Notifications.addNotificationReceivedListener((notification) => {
      void handle(notification, "received");
    });
    const onResponse = Notifications.addNotificationResponseReceivedListener((response) => {
      void handle(response.notification, "opened");
    });
    // A notification that launched the app arrives before any listener attached.
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response !== null) {
          void handle(response.notification, "opened");
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      onReceived.remove();
      onResponse.remove();
    };
  }, [ready, profiles, router, setActive]);
}
