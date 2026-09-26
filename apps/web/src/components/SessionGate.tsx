import type { ServerProfile } from "@aulora/core";
import { Button, Spinner, Text } from "@aulora/ui-web";
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
  const actions = useMemo(() => authActionsFromClient(authClient), [authClient]);

  if (session.isPending) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
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
      <div className="relative">
        <div className="absolute right-4 top-3 z-10">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void actions.signOut();
            }}
          >
            Sign out
          </Button>
        </div>
        <ChatSessionShell
          client={client}
          workspaceName={profile.name}
          user={signedInUser}
          onSignOut={() => {
            void actions.signOut();
          }}
        />
      </div>
    );
  }

  return <SignInScreen profile={profile} actions={actions} />;
}
