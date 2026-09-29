import type { ServerProfile } from "@aulora/core";
import { Spinner, Text } from "@aulora/ui-web";
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
  if (user !== undefined && user !== null) {
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
