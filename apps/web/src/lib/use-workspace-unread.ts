import {
  CONVEX_AUTH_CLIENT_OPTIONS,
  createProviderAuth,
  isTokenRejection,
  type ServerProfile,
} from "@aulora/core";
import { ConvexReactClient } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { createAuloraAuthClient } from "./auth-client";
import { clearSessionToken, readSessionToken } from "./session-token";

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

interface ConvexTokenResult {
  readonly data?: { readonly token?: string } | null;
  readonly error?: unknown;
}

/**
 * Exchanges a profile's persisted Better Auth session bearer for the Convex JWT
 * that its `convex.token()` endpoint mints.
 *
 * The stored `set-auth-token` value is a session bearer, not a Convex access
 * token. Convex verifies the Better Auth plugin's short-lived JWT, so passing
 * the bearer to `setAuth` authenticates nothing. The ordinary signed-in tree
 * exchanges it through `createProviderAuth`; the badge clients must do the same
 * so rotation, bounded outage reuse and a definitive 401 all behave identically.
 */
function convexTokenFetcher(
  profile: ServerProfile,
  onRejected: () => void,
): (args: { forceRefreshToken: boolean }) => Promise<string | null> {
  const authClient = createAuloraAuthClient(profile.siteUrl);
  const providerAuth = createProviderAuth(authClient);
  return async (args) => {
    let result: ConvexTokenResult;
    try {
      result = (await providerAuth.client.convex.token({
        fetchOptions: { throw: false },
        forceRefreshToken: args.forceRefreshToken,
      } as never)) as ConvexTokenResult;
    } catch (error) {
      // A network failure is not a sign-out. The provider wrapper already
      // replays its bounded last token when it has one; when it does not,
      // report signed out for this attempt instead of throwing out of Convex's
      // auth callback.
      if (isTokenRejection(error)) {
        onRejected();
      }
      return null;
    }
    if (result.error !== undefined && result.error !== null) {
      if (isTokenRejection(result.error)) {
        onRejected();
      }
      return null;
    }
    const token = result.data?.token;
    return typeof token === "string" && token.length > 0 ? token : null;
  };
}

export interface WorkspaceUnreadOptions {
  readonly profiles: readonly ServerProfile[];
  readonly activeProfileId: string | undefined;
}

/**
 * Live unread totals for the other saved workspaces, used by the workspace
 * switcher badge on web.
 *
 * Each candidate exchanges its own stored Better Auth session bearer for that
 * profile's Convex JWT through the shared auth wrapper, and runs its own Convex
 * client. A profile without a stored session, or a server without the additive
 * `capabilities.workspaceUnread` flag, is skipped rather than guessed at. A
 * rejected token closes that badge client, clears the stale bearer and drops its
 * badge instead of retaining a websocket that can never authenticate.
 * Subscriptions are torn down and their clients closed when the saved profiles
 * or active workspace change, on unmount, and while the document is hidden. The
 * backing `notifications.unreadSummary` query is itself bounded per workspace.
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

    const dropBadge = (profileId: string) => {
      if (!next.delete(profileId) || cancelled) {
        return;
      }
      setCounts(new Map(next));
    };

    for (const profile of candidates) {
      const sessionBearer = readSessionToken(profile.siteUrl);
      if (sessionBearer === null || sessionBearer.length === 0) {
        continue;
      }
      const client = new ConvexReactClient(profile.convexUrl, CONVEX_AUTH_CLIENT_OPTIONS);
      const entry: {
        client: ConvexReactClient;
        unsubscribe?: () => void;
        closed?: boolean;
      } = { client };
      clients.push(entry);
      const rejectProfile = () => {
        if (cancelled || entry.closed === true) {
          return;
        }
        // The persisted session is definitively gone. Stop the badge client,
        // release its subscription and discard the stale bearer so a later
        // mount does not keep replaying a token the server has rejected.
        entry.closed = true;
        entry.unsubscribe?.();
        delete entry.unsubscribe;
        clearSessionToken(profile.siteUrl);
        dropBadge(profile.id);
        void client.close();
      };
      client.setAuth(convexTokenFetcher(profile, rejectProfile));
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
            if (cancelled) {
              return;
            }
            try {
              const result = watch.localQueryResult();
              if (cancelled || result === undefined) {
                return;
              }
              next.set(profile.id, result.total);
              setCounts(new Map(next));
            } catch {
              // A listener callback can run while the auth/socket state is
              // changing. An error here must not escape the subscription and
              // reject later updates for every badge client.
              dropBadge(profile.id);
            }
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
