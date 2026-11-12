import { CONVEX_AUTH_CLIENT_OPTIONS, type ServerProfile } from "@aulora/core";
import { ConvexReactClient } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { readSessionToken } from "./session-token";

/**
 * At most this many other saved workspaces are subscribed for a nav badge.
 * Their unread query is already bounded per workspace; this caps the number of
 * websocket/query subscriptions one browser holds at once.
 */
export const MAX_WORKSPACE_BADGE_SUBSCRIPTIONS = 4;

/** Older servers do not advertise the capability, so no cross-workspace query runs. */
function supportsWorkspaceUnread(config: unknown): boolean {
  if (typeof config !== "object" || config === null) return false;
  const capabilities = (config as { capabilities?: unknown }).capabilities;
  if (typeof capabilities !== "object" || capabilities === null) return false;
  return (capabilities as { workspaceUnread?: unknown }).workspaceUnread === true;
}

function pageVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

export interface WorkspaceUnreadOptions {
  readonly profiles: readonly ServerProfile[];
  readonly activeProfileId: string | undefined;
}

/**
 * Live unread totals for the other saved workspaces, used by the workspace
 * switcher badge on web.
 *
 * Each candidate uses its own stored bearer token (the cross-origin session
 * token written by `auth-client`) and its own Convex client. A profile without
 * a token, or a server without the additive `capabilities.workspaceUnread`
 * flag, is skipped rather than guessed at. Subscriptions are torn down and
 * their clients closed when the saved profiles or active workspace change, on
 * unmount, and while the document is hidden. The backing
 * `notifications.unreadSummary` query is itself bounded per workspace.
 */
export function useWorkspaceUnreadCounts({
  profiles,
  activeProfileId,
}: WorkspaceUnreadOptions): ReadonlyMap<string, number> {
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [visible, setVisible] = useState(pageVisible);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      setVisible(pageVisible());
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      setCounts(new Map());
      return;
    }
    const candidates = profiles
      .filter((profile) => profile.id !== activeProfileId)
      .slice(0, MAX_WORKSPACE_BADGE_SUBSCRIPTIONS);
    let cancelled = false;
    const clients: Array<{
      readonly client: ConvexReactClient;
      unsubscribe?: () => void;
      closed?: boolean;
    }> = [];
    const next = new Map<string, number>();

    for (const profile of candidates) {
      const token = readSessionToken(profile.siteUrl);
      if (token === null || token.length === 0) {
        continue;
      }
      const client = new ConvexReactClient(profile.convexUrl, CONVEX_AUTH_CLIENT_OPTIONS);
      client.setAuth(async () => token);
      const entry: {
        client: ConvexReactClient;
        unsubscribe?: () => void;
        closed?: boolean;
      } = { client };
      clients.push(entry);
      void client
        .query(api.server.publicConfig, {})
        .then((config) => {
          if (cancelled) {
            return;
          }
          if (!supportsWorkspaceUnread(config)) {
            // This server never advertises the query, so release the client
            // instead of holding an idle websocket for the whole session.
            entry.closed = true;
            void client.close();
            return;
          }
          const watch = client.watchQuery(api.notifications.unreadSummary, {});
          const update = () => {
            const result = watch.localQueryResult();
            if (cancelled || result === undefined) {
              return;
            }
            next.set(profile.id, result.total);
            setCounts(new Map(next));
          };
          entry.unsubscribe = watch.onUpdate(update);
          update();
        })
        .catch(() => undefined);
    }

    if (clients.length === 0) {
      setCounts(new Map());
    }
    return () => {
      cancelled = true;
      for (const entry of clients) {
        entry.unsubscribe?.();
        if (entry.closed !== true) {
          void entry.client.close();
        }
      }
    };
  }, [profiles, activeProfileId, visible]);

  return counts;
}
