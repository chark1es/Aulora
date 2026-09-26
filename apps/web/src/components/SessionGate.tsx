import type { ServerProfile } from "@aulora/core";
import { Spinner, Text } from "@aulora/ui-web";
import { useMemo } from "react";
import { type AuloraAuthClient, authActionsFromClient } from "../lib/auth-client";
import { SignedInShell } from "./SignedInShell";
import { SignInScreen } from "./SignInScreen";

export interface SessionGateProps {
  readonly profile: ServerProfile;
  readonly authClient: AuloraAuthClient;
}

/** Chooses between the sign-in screen and the signed-in shell from the session. */
export function SessionGate({ profile, authClient }: SessionGateProps) {
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
    return (
      <SignedInShell
        profileName={profile.name}
        user={{
          id: user.id,
          ...(typeof user.name === "string" ? { name: user.name } : {}),
          ...(typeof user.email === "string" ? { email: user.email } : {}),
        }}
        onSignOut={() => {
          void actions.signOut();
        }}
      />
    );
  }

  return <SignInScreen profile={profile} actions={actions} />;
}
