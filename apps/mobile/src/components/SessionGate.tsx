import type { ServerProfile } from "@aulora/core";
import { Spinner, Text } from "@aulora/ui-native";
import type { ConvexReactClient } from "convex/react";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import type { AuloraAuthClient } from "../lib/auth-client";
import type { CookieStore } from "../lib/cookie-fetch";
import { ChatProvider } from "../providers/ChatProvider";
import { SoundProvider } from "../providers/SoundProvider";
import { VoiceProvider } from "../providers/VoiceProvider";
import { ChatScreen } from "./chat/ChatScreen";
import { WorkspaceSwitcherSheet } from "./chat/WorkspaceSwitcherSheet";
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
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const router = useRouter();

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
      <SoundProvider>
        <ChatProvider client={client}>
          <VoiceProvider client={client} userId={user.id}>
            <ChatScreen
              workspaceName={profile.name}
              ownUserId={user.id}
              ownDisplayName={displayName}
              onSignOut={() => {
                void authClient.signOut();
              }}
            />
          </VoiceProvider>
        </ChatProvider>
      </SoundProvider>
    );
  }

  return (
    <>
      <SignInScreen
        profile={profile}
        authClient={authClient}
        cookieStore={cookieStore}
        onOpenWorkspaces={() => setSwitcherOpen(true)}
        onConnectDifferentServer={() => router.push("/connect")}
      />
      <WorkspaceSwitcherSheet visible={switcherOpen} onClose={() => setSwitcherOpen(false)} />
    </>
  );
}
