/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { ServerProfile } from "@aulora/core";
import { Spinner, Text } from "@aulora/ui-web";
import type { ConvexReactClient } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { type AuloraAuthClient, type AuthActions, authActionsFromClient } from "../lib/auth-client";
import { useServerRecovery } from "../lib/use-server-recovery";
import { useStuckTimeout } from "../lib/use-stuck-timeout";
import {
  ConnectionRecoveryActions,
  type ConnectionRecoveryActionsProps,
} from "./ConnectionRecoveryActions";
import { ChatSessionShell, type ChatSessionShellRecovery } from "./chat/ChatSessionShell";
import { MembershipGate } from "./MembershipGate";
import { SignInScreen } from "./SignInScreen";

export interface SessionGateProps {
  readonly profile: ServerProfile;
  readonly authClient: AuloraAuthClient;
  readonly client: ConvexReactClient;
}

/** Chooses between the sign-in screen and the signed-in shell from the session. */
export function SessionGate({ profile, authClient, client }: SessionGateProps) {
  const session = authClient.useSession();
  const actions = useMemo(() => authActionsFromClient(authClient), [authClient]);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [shellAttempt, setShellAttempt] = useState(0);
  const sessionStuck = useStuckTimeout(session.isPending, sessionAttempt);

  const retrySession = useCallback(() => {
    void session.refetch();
    setSessionAttempt((attempt) => attempt + 1);
  }, [session]);
  const { recovery, switchServer } = useServerRecovery(profile, retrySession);

  if (session.isPending) {
    return <SessionPending stuck={sessionStuck} recovery={recovery} />;
  }

  const user = session.data?.user;

  // A failed lookup is not a signed-out session: the stored login is still
  // valid, so offer a retry instead of sending the person to the sign-in form.
  if (user === undefined && session.error) {
    return <SessionUnreachable profileName={profile.name} recovery={recovery} />;
  }

  if (user !== undefined) {
    return (
      <SignedInShell
        client={client}
        profile={profile}
        user={user}
        actions={actions}
        recovery={recovery}
        attempt={shellAttempt}
        onRetry={() => {
          setShellAttempt((attempt) => attempt + 1);
        }}
      />
    );
  }

  return <SignInScreen profile={profile} actions={actions} onSwitchServer={switchServer} />;
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
  attempt,
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
  readonly attempt: number;
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
    <MembershipGate
      workspaceIconSeed={profile.iconSeed}
      signedInAs={signedInUser.email ?? signedInUser.name ?? null}
      onSignOut={signOut}
    >
      <ChatSessionShell
        key={attempt}
        client={client}
        workspaceName={profile.name}
        workspaceIconSeed={profile.iconSeed}
        user={signedInUser}
        onSignOut={signOut}
        recovery={shellRecovery}
      />
    </MembershipGate>
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
