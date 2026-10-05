import type { ServerProfile } from "@aulora/core";
import { Button, Spinner, Text } from "@aulora/ui-web";
import { useNavigate } from "@tanstack/react-router";
import type { ConvexReactClient } from "convex/react";
import { useMemo } from "react";
import { type AuloraAuthClient, authActionsFromClient } from "../lib/auth-client";
import { ChatSessionShell } from "./chat/ChatSessionShell";
import { SignInScreen } from "./SignInScreen";

export interface SessionGateProps {
  readonly profile: ServerProfile;
  readonly authClient: AuloraAuthClient;
  readonly client: ConvexReactClient;
}

/** Chooses between the sign-in screen and the signed-in shell from the session. */
export function SessionGate({ profile, authClient, client }: SessionGateProps) {
  const session = authClient.useSession();
  const navigate = useNavigate();
  const actions = useMemo(() => authActionsFromClient(authClient), [authClient]);

  if (session.isPending) {
    return (
      <div className="pane flex flex-1 flex-col items-center justify-center gap-3">
        <Spinner size={28} label="Checking your session" />
        <Text tone="muted" size="sm">
          Checking your session…
        </Text>
      </div>
    );
  }

  const user = session.data?.user;

  // A failed lookup is not a signed-out session: the stored login is still
  // valid, so offer a retry instead of sending the person to the sign-in form.
  if (user === undefined && session.error) {
    return (
      <SessionUnreachable
        profileName={profile.name}
        onRetry={() => void session.refetch()}
        onSwitchServer={() => void navigate({ to: "/connect" })}
      />
    );
  }

  if (user !== undefined) {
    const signedInUser = {
      id: user.id,
      ...(typeof user.name === "string" ? { name: user.name } : {}),
      ...(typeof user.email === "string" ? { email: user.email } : {}),
    };
    return (
      <ChatSessionShell
        client={client}
        workspaceName={profile.name}
        workspaceIconSeed={profile.iconSeed}
        user={signedInUser}
        onSignOut={() => {
          void actions.signOut();
        }}
      />
    );
  }

  return (
    <SignInScreen
      profile={profile}
      actions={actions}
      onSwitchServer={() => void navigate({ to: "/connect" })}
    />
  );
}

function SessionUnreachable({
  profileName,
  onRetry,
  onSwitchServer,
}: {
  readonly profileName: string;
  readonly onRetry: () => void;
  readonly onSwitchServer: () => void;
}) {
  return (
    <div className="pane flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <Text size="md" className="font-medium">
        Can't reach {profileName}
      </Text>
      <Text tone="muted" size="sm">
        You're still signed in. Check your connection and try again.
      </Text>
      <div className="flex gap-2">
        <Button size="md" onClick={onRetry}>
          Try again
        </Button>
        <Button size="md" variant="ghost" onClick={onSwitchServer}>
          Use a different server
        </Button>
      </div>
    </div>
  );
}
