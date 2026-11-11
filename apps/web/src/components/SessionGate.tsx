/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import {
  clientVersionState,
  debugLog,
  resetProviderToken,
  type ServerProfile,
  setProviderTokenIdentity,
  subscribeAuthChanged,
} from "@aulora/core";
import { Spinner, Text } from "@aulora/ui-web";
import type { ConvexReactClient } from "convex/react";
import { useConvexAuth, useQuery } from "convex/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { type AuloraAuthClient, type AuthActions, authActionsFromClient } from "../lib/auth-client";
import { isInvalidSessionError } from "../lib/auth-errors";
import { CLIENT_VERSION } from "../lib/client-version";
import type { ConnectionRecovery } from "../lib/connection-recovery";
import { logAuthState, useRemountLog } from "../lib/remount-debug";
import { clearSessionToken, readSessionToken } from "../lib/session-token";
import { storageScope } from "../lib/storage-scope";
import { useLastDefined } from "../lib/use-last-defined";
import { useServerRecovery } from "../lib/use-server-recovery";
import { useStuckTimeout } from "../lib/use-stuck-timeout";
import { restoreWebPushDevice, revokeWebPushDevice } from "../lib/web-push";
import {
  ClientVersionNotice,
  ClientVersionRequired,
  ServerUpdateRequired,
  useClientVersionPolicy,
  useOutdatedServer,
} from "./ClientVersionGate";
import {
  ConnectionRecoveryActions,
  type ConnectionRecoveryActionsProps,
} from "./ConnectionRecoveryActions";
import { ChatSessionShell, type ChatSessionShellRecovery } from "./chat/ChatSessionShell";
import { LegacyRecoveryNotice } from "./LegacyRecoveryNotice";
import { MembershipGate } from "./MembershipGate";
import { QueryErrorBoundary } from "./QueryErrorBoundary";
import { SignInScreen } from "./SignInScreen";

// First-run claim only: a fresh instance sees it once, so keep it out of the
// code every signed-in session downloads.
const SetupScreen = lazy(() =>
  import("./SetupScreen").then((module) => ({ default: module.SetupScreen })),
);

export interface SessionGateProps {
  readonly profile: ServerProfile;
  readonly authClient: AuloraAuthClient;
  readonly client: ConvexReactClient;
  /**
   * Owns rebuilding the Convex and Better Auth clients. Every retry goes
   * through it: the clients keep the dead websocket, token cache and auth
   * backoff that made the connection stick, so retrying them in place cannot
   * succeed.
   */
  readonly connection: ConnectionRecovery;
}

/**
 * How long a signed-out gate waits for `server.publicConfig` before showing the
 * sign-in form with a retry notice. The form is usable from the profile’s
 * cached auth snapshot, so waiting forever only blocks people whose config
 * query is down.
 */
export const CONFIG_WAIT_TIMEOUT_MS = 4_000;

/** Chooses between the sign-in screen and the signed-in shell from the session. */
export function SessionGate({ profile, authClient, client, connection }: SessionGateProps) {
  useRemountLog("SessionGate");
  const clientVersion = useClientVersionPolicy();
  const outdatedServer = useOutdatedServer();
  const session = authClient.useSession();
  // Read setup state from the existing public-config subscription rather than
  // a new query, so a new client can still reach the sign-in form against a
  // slightly older backend that does not know `setup.state` yet. Keep the last
  // answer across a reconnect so a momentarily missing config can never unmount
  // the signed-in tree or flash the setup screen.
  const setupConfig = useLastDefined(useQuery(api.server.publicConfig, {}));
  const actions = useMemo(
    () =>
      authActionsFromClient(
        authClient,
        () => revokeWebPushDevice(client, session.data?.user.id),
        () => restoreWebPushDevice(client, session.data?.user.id),
      ),
    [authClient, client, session.data?.user.id],
  );
  const {
    isAuthenticated: convexAuthenticated,
    isRefreshing: convexRefreshing,
    isLoading: convexLoading,
  } = useConvexAuth();
  const user = session.data?.user;
  const signedIn = user !== undefined;
  const invalidSession = isInvalidSessionError(session.error);
  const droppedInvalidSession = useRef(false);
  const refetchSession = session.refetch;

  // An OAuth finish in an external browser stores a token outside this client’s
  // session atom. Refetch instead of reloading the page.
  useEffect(
    () =>
      subscribeAuthChanged(() => {
        void refetchSession();
      }),
    [refetchSession],
  );

  // Opt-in (`aulora.debug.remount`): records every auth state change, which is
  // what decides whether the shell stays mounted.
  useEffect(() => {
    logAuthState({
      isAuthenticated: convexAuthenticated,
      isLoading: convexLoading,
      isRefreshing: convexRefreshing,
    });
  }, [convexAuthenticated, convexLoading, convexRefreshing]);

  const retry = useCallback(() => {
    connection.retry();
  }, [connection]);
  const { recovery, switchServer } = useServerRecovery(profile, retry);

  // Bind the Convex token cache to this Better Auth session. Sign-out resets it
  // synchronously (see `authActionsFromClient`); this covers an account switch
  // inside one client, where the next transient failure would otherwise serve
  // the previous person’s token.
  const sessionId = session.data?.session?.id;
  const providerIdentity = user === undefined ? null : `${sessionId ?? ""}:${user.id}`;
  useEffect(() => {
    if (providerIdentity === null) {
      return;
    }
    setProviderTokenIdentity(authClient, providerIdentity);
  }, [authClient, providerIdentity]);

  // A signed-out person must not wait forever for `server.publicConfig` before
  // reaching the sign-in form. After a bounded wait show the form with a notice
  // and keep re-asking; a missing answer is still never read as "setup
  // required", which stays gated on `setupRequired === true` below.
  const [configTimedOut, setConfigTimedOut] = useState(false);
  useEffect(() => {
    if (setupConfig !== undefined) {
      setConfigTimedOut(false);
      return;
    }
    const timer = setTimeout(() => {
      setConfigTimedOut(true);
    }, CONFIG_WAIT_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [setupConfig]);
  const retryConfig = useCallback(() => {
    // A one-shot query reuses the live websocket and refreshes the cached
    // result every subscription reads; unlike `connection.retry` it does not
    // rebuild the client pair or discard what the person typed.
    if (typeof client.query !== "function") {
      return;
    }
    try {
      void client.query(api.server.publicConfig, {}).catch(() => undefined);
    } catch {
      // The client is already closed; the next rebuild or reconnect retries.
    }
  }, [client]);
  useEffect(() => {
    if (!configTimedOut || user !== undefined) {
      return;
    }
    retryConfig();
    const timer = setInterval(retryConfig, CONFIG_WAIT_TIMEOUT_MS);
    return () => {
      clearInterval(timer);
    };
  }, [configTimedOut, retryConfig, user]);

  // Better Auth answers 401 only for credentials that are gone, so a stored
  // token that gets one is dead: drop it and start over. Any other failure may
  // be an outage and must keep the login (see `isInvalidSessionError`). Only a
  // token that was actually stored warrants a rebuild — with none, the rejected
  // cookie cannot be cleared here, and rebuilding would replay the same answer
  // forever, so the sign-in form is the honest end state.
  useEffect(() => {
    if (!invalidSession || droppedInvalidSession.current) {
      return;
    }
    droppedInvalidSession.current = true;
    debugLog.clear();
    resetProviderToken(authClient);
    const storedToken = readSessionToken(profile.siteUrl) !== null;
    clearSessionToken(profile.siteUrl);
    if (storedToken) {
      connection.retry();
    }
  }, [invalidSession, authClient, profile.siteUrl, connection]);

  // Every wait a server restart can break: a session lookup that never answers
  // or fails, and — the case that used to stick forever — a signed-in session
  // Convex will not accept. Nothing inside a rendered screen can clear that,
  // because the dead client is the one it would retry, so rebuild on a backoff
  // until the connection is healthy again.
  //
  // Only a session Convex actually rejects is rebuilt automatically. A slow or
  // failed background session lookup is recoverable in place: tearing the tree
  // down for it would discard the open channel, panels and a call, and a slow
  // network could rebuild again on every pass. `isLoading` means Convex has not
  // answered yet (a cold start or a slow server), which is not a rejection.
  const rejectedSession = signedIn && !convexAuthenticated && !convexRefreshing && !convexLoading;
  const waiting =
    !invalidSession &&
    ((user === undefined && (session.isPending || session.error !== undefined)) || rejectedSession);
  const stuck = useStuckTimeout(waiting);
  useEffect(() => {
    if (stuck && rejectedSession) {
      connection.stuck();
    } else if (!waiting) {
      connection.healthy();
    }
    // While a wait is running but not yet stuck, leave the backoff alone:
    // clearing it here would restart every rebuild at the shortest delay.
  }, [stuck, waiting, rejectedSession, connection]);

  // Compatibility gate: a too-old client must not reach the sign-in form or
  // talk to a backend it cannot understand. Placed after every hook so the
  // hook order stays stable when the config query resolves.
  if (clientVersion !== null && clientVersionState(CLIENT_VERSION, clientVersion) === "required") {
    return <ClientVersionRequired policy={clientVersion} />;
  }
  if (outdatedServer !== null) {
    return <ServerUpdateRequired serverVersion={outdatedServer.version} recovery={recovery} />;
  }

  // A fresh instance has no owner. The claim screen precedes sign-in because
  // there is no account to sign in with yet. Never infer "setup required" from
  // a missing config: while the answer is unknown a signed-in shell keeps
  // rendering, and signed-out callers wait for the answer instead.
  if (setupConfig?.setupRequired === true) {
    return (
      <Suspense fallback={<SessionPending stuck={false} recovery={recovery} />}>
        <SetupScreen profile={profile} actions={actions} onSwitchServer={switchServer} />
      </Suspense>
    );
  }

  if (session.isPending) {
    return <SessionPending stuck={stuck} recovery={recovery} />;
  }

  // A rejected login means signed out, even if the stored error would otherwise
  // read as a connectivity problem; the effect above has already dropped it.
  if (invalidSession) {
    return <SignInScreen profile={profile} actions={actions} onSwitchServer={switchServer} />;
  }

  if (user === undefined) {
    // A failed lookup is not a signed-out session: the stored login is still
    // valid, so offer a retry instead of sending the person to the sign-in form.
    if (session.error) {
      return <SessionUnreachable profileName={profile.name} recovery={recovery} />;
    }
    // A fresh instance has to show its claim screen, but an unknown answer is
    // not the same as "no setup needed". Wait briefly for the config, then let
    // the form through with a soft notice instead of blocking sign-in forever
    // on a query that may never answer.
    const configMissing = setupConfig === undefined;
    if (configMissing && !configTimedOut) {
      return <SessionPending stuck={stuck} recovery={recovery} />;
    }
    return (
      <SignInScreen
        profile={profile}
        actions={actions}
        onSwitchServer={switchServer}
        notice={configMissing ? "Can’t reach the workspace config. Retrying" : undefined}
        onRetryNotice={configMissing ? retryConfig : undefined}
      />
    );
  }

  return (
    <SignedInShell
      client={client}
      profile={profile}
      user={user}
      actions={actions}
      recovery={recovery}
      recommendedClientVersion={clientVersion?.recommendedClientVersion ?? null}
      onRetry={retry}
    />
  );
}

function SessionPending({
  stuck,
  recovery,
}: {
  readonly stuck: boolean;
  readonly recovery: ConnectionRecoveryActionsProps;
}) {
  return (
    <div className="pane flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <Spinner size={28} label="Checking your session" />
      <Text tone="muted" size="sm">
        Checking your session…
      </Text>
      {stuck && (
        <>
          <Text tone="muted" size="sm">
            This is taking longer than usual.
          </Text>
          <ConnectionRecoveryActions {...recovery} />
        </>
      )}
    </div>
  );
}

function SignedInShell({
  client,
  profile,
  user,
  actions,
  recovery,
  recommendedClientVersion,
  onRetry,
}: {
  readonly client: ConvexReactClient;
  readonly profile: ServerProfile;
  readonly user: {
    readonly id: string;
    readonly name?: string | null;
    readonly email?: string | null;
  };
  readonly actions: AuthActions;
  readonly recovery: ConnectionRecoveryActionsProps;
  readonly recommendedClientVersion: string | null;
  readonly onRetry: () => void;
}) {
  const signedInUser = {
    id: user.id,
    ...(typeof user.name === "string" ? { name: user.name } : {}),
    ...(typeof user.email === "string" ? { email: user.email } : {}),
  };
  const shellRecovery: ChatSessionShellRecovery = { ...recovery, onRetry };
  const signOut = () => {
    void actions.signOut();
  };
  return (
    <>
      <ClientVersionNotice recommendedVersion={recommendedClientVersion} />
      <QueryErrorBoundary
        client={client}
        onReconnect={onRetry}
        onSignOut={signOut}
        onSwitchServer={recovery.onSwitchServer}
      >
        <MembershipGate
          workspaceIconSeed={profile.iconSeed}
          signedInAs={signedInUser.email ?? signedInUser.name ?? null}
          onSignOut={signOut}
        >
          <LegacyRecoveryNotice
            key={storageScope(profile.baseUrl, user.id)}
            scope={storageScope(profile.baseUrl, user.id)}
          />
          <ChatSessionShell
            client={client}
            workspaceName={profile.name}
            workspaceIconSeed={profile.iconSeed}
            user={signedInUser}
            onSignOut={signOut}
            recovery={shellRecovery}
          />
        </MembershipGate>
      </QueryErrorBoundary>
    </>
  );
}

function SessionUnreachable({
  profileName,
  recovery,
}: {
  readonly profileName: string;
  readonly recovery: ConnectionRecoveryActionsProps;
}) {
  return (
    <div className="pane flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <Text size="md" className="font-medium">
        Can’t reach {profileName}
      </Text>
      <Text tone="muted" size="sm">
        You’re still signed in. Check your connection and try again.
      </Text>
      <ConnectionRecoveryActions {...recovery} />
    </div>
  );
}
