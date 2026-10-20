/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
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
import { useStuckTimeout } from "../lib/stuck-timeout";
import { ChatProvider } from "../providers/ChatProvider";
import { useProfiles } from "../providers/ProfileProvider";
import { SoundProvider } from "../providers/SoundProvider";
import { VoiceProvider } from "../providers/VoiceProvider";
import {
  ConnectionRecoveryActions,
  type ConnectionRecoveryActionsProps,
} from "./ConnectionRecoveryActions";
import { ChatScreen } from "./chat/ChatScreen";
import { WorkspaceSwitcherSheet } from "./chat/WorkspaceSwitcherSheet";
import { MembershipGate } from "./MembershipGate";
import { QueryErrorBoundary } from "./QueryErrorBoundary";
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
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const router = useRouter();
  const { profiles, remove } = useProfiles();
  const sessionStuck = useStuckTimeout(session.isPending, sessionAttempt);
  const canRemoveServer = profiles.some((entry) => entry.id === profile.id);

  const backToConnect = () => {
    router.push("/connect");
  };

  const identity = session.data?.user?.id ?? null;
  useEffect(() => {
    bindPendingInvite(identity);
  }, [identity]);

  if (session.isPending) {
    return (
      <SessionPending
        stuck={sessionStuck}
        recovery={{
          serverName: profile.name,
          canRemoveServer,
          onRetry: () => {
            void session.refetch();
            setSessionAttempt((attempt) => attempt + 1);
          },
          onSwitchServer: backToConnect,
          onRemoveServer: () => {
            void remove(profile.id);
            backToConnect();
          },
        }}
      />
    );
  }

  const user = session.data?.user;
  if (user !== undefined && user !== null) {
    return <SignedInChat profile={profile} authClient={authClient} client={client} user={user} />;
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
        onConnectDifferentServer={backToConnect}
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

function SessionPending({
  stuck,
  recovery,
}: {
  readonly stuck: boolean;
  readonly recovery: ConnectionRecoveryActionsProps;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-6">
      <Spinner size={28} label="Checking your session" />
      <Text size="sm" tone="muted">
        Checking your session…
      </Text>
      {stuck && (
        <>
          <Text size="sm" tone="muted">
            This is taking longer than usual.
          </Text>
          <ConnectionRecoveryActions {...recovery} />
        </>
      )}
    </View>
  );
}

function SignedInChat({
  profile,
  authClient,
  client,
  user,
}: {
  readonly profile: ServerProfile;
  readonly authClient: AuloraAuthClient;
  readonly client: ConvexReactClient;
  readonly user: {
    readonly id: string;
    readonly name?: string | null;
    readonly email?: string | null;
  };
}) {
  const signOut = async () => {
    const result = await authClient.signOut();
    if (result.error) throw new Error(result.error.message ?? "Couldn't sign out");
  };
  return (
    <QueryErrorBoundary client={client} onSignOut={() => void signOut()}>
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
    </QueryErrorBoundary>
  );
}
