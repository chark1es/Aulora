/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { clientVersionState, type ServerProfile } from "@aulora/core";
import { Spinner, Text } from "@aulora/ui-web";
import type { ConvexReactClient } from "convex/react";
import { useConvexAuth } from "convex/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { type AuloraAuthClient, type AuthActions, authActionsFromClient } from "../lib/auth-client";
import { isInvalidSessionError } from "../lib/auth-errors";
import { CLIENT_VERSION } from "../lib/client-version";
import type { ConnectionRecovery } from "../lib/connection-recovery";
import { clearSessionToken, readSessionToken } from "../lib/session-token";
import { useServerRecovery } from "../lib/use-server-recovery";
import { useStuckTimeout } from "../lib/use-stuck-timeout";
import {
  ClientVersionNotice,
  ClientVersionRequired,
  useClientVersionPolicy,
} from "./ClientVersionGate";
import {
  ConnectionRecoveryActions,
  type ConnectionRecoveryActionsProps,
} from "./ConnectionRecoveryActions";
import { ChatSessionShell, type ChatSessionShellRecovery } from "./chat/ChatSessionShell";
import { MembershipGate } from "./MembershipGate";
import { QueryErrorBoundary } from "./QueryErrorBoundary";
import { SignInScreen } from "./SignInScreen";

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

/** Chooses between the sign-in screen and the signed-in shell from the session. */
export function SessionGate({ profile, authClient, client, connection }: SessionGateProps) {
  const clientVersion = useClientVersionPolicy();
  const session = authClient.useSession();
  const actions = useMemo(() => authActionsFromClient(authClient), [authClient]);
  const { isAuthenticated: convexAuthenticated } = useConvexAuth();
  const user = session.data?.user;
  const signedIn = user !== undefined;
  const invalidSession = isInvalidSessionError(session.error);
  const droppedInvalidSession = useRef(false);

  const retry = useCallback(() => {
    connection.retry();
  }, [connection]);
  const { recovery, switchServer } = useServerRecovery(profile, retry);

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
    const storedToken = readSessionToken(profile.siteUrl) !== null;
    clearSessionToken(profile.siteUrl);
    if (storedToken) {
      connection.retry();
    }
  }, [invalidSession, profile.siteUrl, connection]);

  // Every wait a server restart can break: a session lookup that never answers
  // or fails, and — the case that used to stick forever — a signed-in session
  // Convex will not accept. Nothing inside a rendered screen can clear that,
  // because the dead client is the one it would retry, so rebuild on a backoff
  // until the connection is healthy again.
  const waiting =
    !invalidSession &&
    (session.isPending || session.error !== undefined || (signedIn && !convexAuthenticated));
  const stuck = useStuckTimeout(waiting);
  useEffect(() => {
    if (stuck) {
      connection.stuck();
    } else if (!waiting) {
      connection.healthy();
    }
    // While a wait is running but not yet stuck, leave the backoff alone:
    // clearing it here would restart every rebuild at the shortest delay.
  }, [stuck, waiting, connection]);

  // Compatibility gate: a too-old client must not reach the sign-in form or
  // talk to a backend it cannot understand. Placed after every hook so the
  // hook order stays stable when the config query resolves.
  if (clientVersion !== null && clientVersionState(CLIENT_VERSION, clientVersion) === "required") {
    return <ClientVersionRequired policy={clientVersion} />;
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
    return <SignInScreen profile={profile} actions={actions} onSwitchServer={switchServer} />;
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
        Can't reach {profileName}
      </Text>
      <Text tone="muted" size="sm">
        You're still signed in. Check your connection and try again.
      </Text>
      <ConnectionRecoveryActions {...recovery} />
    </div>
  );
}
