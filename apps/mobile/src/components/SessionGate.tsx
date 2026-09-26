import type { ServerProfile } from "@aulora/core";
import { Spinner, Text } from "@aulora/ui-native";
import type { ConvexReactClient } from "convex/react";
import { View } from "react-native";
import type { AuloraAuthClient } from "../lib/auth-client";
import type { CookieStore } from "../lib/cookie-fetch";
import { ChatProvider } from "../providers/ChatProvider";
import { ChatScreen } from "./chat/ChatScreen";
import { SignInScreen } from "./SignInScreen";

export interface SessionGateProps {
  readonly profile: ServerProfile;
  readonly authClient: AuloraAuthClient;
  readonly cookieStore: CookieStore;
  readonly client: ConvexReactClient;
}

/** Chooses between the sign-in screen and the signed-in chat surface. */
export function SessionGate({ profile, authClient, cookieStore, client }: SessionGateProps) {
  const session = authClient.useSession();

  if (session.isPending) {
    return (
      <View className="flex-1 items-center justify-center gap-3">
        <Spinner size={28} label="Checking your session" />
        <Text size="sm" tone="muted">
          Checking your session…
        </Text>
      </View>
    );
  }

  const user = session.data?.user;
  if (user !== undefined && user !== null) {
    const displayName = user.name ?? user.email ?? "You";
    return (
      <ChatProvider client={client} userId={user.id} displayName={displayName}>
        <ChatScreen
          workspaceName={profile.name}
          ownUserId={user.id}
          ownDisplayName={displayName}
          onSignOut={() => {
            void authClient.signOut();
          }}
        />
      </ChatProvider>
    );
  }

  return <SignInScreen profile={profile} authClient={authClient} cookieStore={cookieStore} />;
}
