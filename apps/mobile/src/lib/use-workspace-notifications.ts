import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useProfiles } from "../providers/ProfileProvider";
import {
  backfillWorkspaceServerId,
  clearWorkspaceUnread,
  ensureWorkspaceNotificationsLoaded,
  readWorkspaceNotificationHint,
  recordWorkspaceUnread,
  resolveWorkspaceProfile,
  setWorkspaceNotificationTarget,
  subscribeWorkspaceUnread,
  workspaceServerIdForProfile,
  workspaceUnreadSnapshot,
} from "./workspace-identity";

/** How many notification ids are remembered in each lifecycle set. */
const SEEN_LIMIT = 64;
/** Pending wakes are few; a burst cannot grow the queue without bound. */
const PENDING_LIMIT = 8;
/** A cold start may race profile hydration; retry a bounded number of times. */
const MAX_RETRIES = 6;
const RETRY_MS = 5_000;

/** Bounded membership set that remembers the most recent ids. */
function remember(seen: Set<string>, id: string): boolean {
  if (seen.has(id)) {
    return false;
  }
  if (seen.size >= SEEN_LIMIT) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) {
      seen.delete(oldest);
    }
  }
  seen.add(id);
  return true;
}

/**
 * A notification may be delivered more than once (received then opened, a
 * replayed launch response, or the effect rerunning after an auth/profile
 * change). Keep the two outcomes separate instead of marking an id as done
 * before routing: `processed` only holds ids whose route completed, so a
 * cancelled or unresolvable attempt stays retryable. `counted` is separate so a
 * retry after a badge increment cannot add the badge twice.
 */
const processedReceived = new Set<string>();
const processedOpened = new Set<string>();
const counted = new Set<string>();

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
  const pendingOpen = useRef(new Map<string, Notifications.Notification>());
  const pendingReceived = useRef(new Map<string, Notifications.Notification>());
  const inFlight = useRef(new Set<string>());
  const mounted = useRef(true);
  const [retryNonce, setRetryNonce] = useState(0);

  // An in-flight handle can resume after this effect was replaced by a profile
  // change. It still needs to queue the wake and ask for a retry, so only a real
  // unmount stops scheduling.
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

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
    // A transient identity/profile failure with no further profile change still
    // needs a bounded retry. Attempts are capped, and a new profile or ready
    // transition reruns this effect immediately.
    let retry: ReturnType<typeof setTimeout> | undefined;
    const scheduleRetry = () => {
      if (!mounted.current || retry !== undefined || retryNonce >= MAX_RETRIES) {
        return;
      }
      retry = setTimeout(() => {
        setRetryNonce((value) => value + 1);
      }, RETRY_MS);
    };

    const queuePending = (notification: Notifications.Notification, mode: WakeMode) => {
      const pending = mode === "opened" ? pendingOpen.current : pendingReceived.current;
      pending.set(notification.request.identifier, notification);
      if (pending.size > PENDING_LIMIT) {
        const oldest = pending.keys().next().value;
        if (oldest !== undefined) {
          pending.delete(oldest);
        }
      }
      scheduleRetry();
    };

    const handle = async (notification: Notifications.Notification, mode: WakeMode) => {
      const request = notification.request;
      const id = request.identifier;
      const processed = mode === "opened" ? processedOpened : processedReceived;
      if (processed.has(id)) {
        return;
      }
      const flightKey = `${mode}:${id}`;
      if (inFlight.current.has(flightKey)) {
        return;
      }
      inFlight.current.add(flightKey);
      try {
        const hint = readWorkspaceNotificationHint(request.content.data);
        if (hint === null) {
          // Malformed/local data cannot improve on retry.
          processed.add(id);
          return;
        }
        await ensureWorkspaceNotificationsLoaded();
        if (cancelled) {
          queuePending(notification, mode);
          return;
        }
        // Resolution itself accepts an already-verified cached id. It refuses
        // a partial cache, so the bridge must not take a separate synchronous
        // shortcut: that path could route a shared opaque id to the first
        // workspace whose identity happened to be learned.
        const profile = await resolveWorkspaceProfile(profiles, hint.serverId).catch(
          () => undefined,
        );
        if (cancelled) {
          queuePending(notification, mode);
          return;
        }
        if (profile === undefined) {
          // Profiles may hydrate after the launch response, or an identity
          // fetch may be transiently unavailable. Keep the wake for the next
          // effect run instead of consuming its id.
          queuePending(notification, mode);
          return;
        }

        const apply = () => {
          setWorkspaceNotificationTarget(profile.id, hint.channelId, hint.messageId, hint.kind);
        };

        if (mode === "opened") {
          apply();
          if (activeIdRef.current === profile.id) {
            clearWorkspaceUnread(profile.id);
            processed.add(id);
            return;
          }
          try {
            await setActive(profile.id);
          } catch {
            // A refused write leaves the current workspace active. The target
            // stays for the next successful switch; retry this wake later.
            queuePending(notification, mode);
            return;
          }
          if (cancelled) {
            queuePending(notification, mode);
            return;
          }
          clearWorkspaceUnread(profile.id);
          router.replace("/");
          processed.add(id);
          return;
        }

        // A wake for a workspace that is not open: badge it, then move to it so
        // the person lands on the new message rather than having to tap twice.
        if (activeIdRef.current === profile.id) {
          processed.add(id);
          return;
        }
        if (remember(counted, id)) {
          recordWorkspaceUnread(profile.id);
        }
        apply();
        try {
          await setActive(profile.id);
        } catch {
          // Keep the badge; the switcher still exposes the workspace. This is
          // not a reason to count the same wake again on the next effect run.
          processed.add(id);
          return;
        }
        if (cancelled) {
          queuePending(notification, mode);
          return;
        }
        clearWorkspaceUnread(profile.id);
        router.replace("/");
        processed.add(id);
      } finally {
        inFlight.current.delete(flightKey);
      }
    };

    const flushPending = () => {
      const opened = [...pendingOpen.current.values()];
      const received = [...pendingReceived.current.values()];
      pendingOpen.current.clear();
      pendingReceived.current.clear();
      for (const notification of opened) {
        void handle(notification, "opened");
      }
      for (const notification of received) {
        void handle(notification, "received");
      }
      if (opened.length > 0 || received.length > 0) {
        scheduleRetry();
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

    if (pendingOpen.current.size > 0 || pendingReceived.current.size > 0) {
      scheduleRetry();
    }

    return () => {
      cancelled = true;
      if (retry !== undefined) clearTimeout(retry);
      onReceived.remove();
      onResponse.remove();
    };
  }, [ready, profiles, router, setActive, retryNonce]);
}
