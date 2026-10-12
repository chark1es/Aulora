import type { ServerProfile } from "@aulora/core";
import { Spinner, Text } from "@aulora/ui-native";
import type { ConvexReactClient } from "convex/react";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { AuloraAuthClient } from "../lib/auth-client";
import type { CookieStore } from "../lib/cookie-fetch";
import { bindPendingInvite } from "../lib/pending-invite";
import { ChatProvider } from "../providers/ChatProvider";
import { SoundProvider } from "../providers/SoundProvider";
import { VoiceProvider } from "../providers/VoiceProvider";
import { ChatScreen } from "./chat/ChatScreen";
import { WorkspaceSwitcherSheet } from "./chat/WorkspaceSwitcherSheet";
import { MembershipGate } from "./MembershipGate";
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

  const identity = session.data?.user?.id ?? null;
  useEffect(() => {
    bindPendingInvite(identity);
  }, [identity]);

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
    return <SignedIn profile={profile} authClient={authClient} client={client} user={user} />;
  }

  // The chat surface lays out its own safe areas; only sign-in needs the frame.
  return (
    <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
      <SignInScreen
        profile={profile}
        authClient={authClient}
        cookieStore={cookieStore}
        onOpenWorkspaces={() => {
          setSwitcherOpen(true);
        }}
        onConnectDifferentServer={() => {
          router.push("/connect");
        }}
      />
      <WorkspaceSwitcherSheet
        visible={switcherOpen}
        onClose={() => {
          setSwitcherOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

interface SignedInProps {
  readonly profile: ServerProfile;
  readonly authClient: AuloraAuthClient;
  readonly client: ConvexReactClient;
  readonly user: {
    readonly id: string;
    readonly name?: string | null;
    readonly email?: string | null;
  };
}

/** The chat surface, behind the membership gate, for a signed-in account. */
function SignedIn({ profile, authClient, client, user }: SignedInProps) {
  const signOut = async () => {
    const result = await authClient.signOut();
    if (result.error) throw new Error(result.error.message ?? "Couldn't sign out");
  };
  return (
    <MembershipGate
      workspaceIconSeed={profile.iconSeed}
      signedInAs={user.email ?? user.name ?? null}
      onSignOut={() => void signOut()}
    >
      <SoundProvider>
        <ChatProvider key={user.id} client={client} userId={user.id}>
          <VoiceProvider client={client} userId={user.id}>
            <ChatScreen
              workspaceName={profile.name}
              ownUserId={user.id}
              ownDisplayName={user.name ?? user.email ?? "You"}
              onSignOut={signOut}
            />
          </VoiceProvider>
        </ChatProvider>
      </SoundProvider>
    </MembershipGate>
  );
}
