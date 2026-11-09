/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { ServerProfile } from "@aulora/core";
import { Spinner, Text } from "@aulora/ui-native";
import type { ConvexReactClient } from "convex/react";
import { useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../../../packages/convex/convex/_generated/api";
import type { AuloraAuthClient } from "../lib/auth-client";
import { authActionsFromClient } from "../lib/auth-client";
import { subscribeAuthChanged } from "../lib/auth-events";
import { mobileVersionState } from "../lib/client-version";
import type { CookieStore } from "../lib/cookie-fetch";
import { bindPendingInvite } from "../lib/pending-invite";
import { resetProviderToken, setProviderTokenIdentity } from "../lib/provider-auth";
import { useStuckTimeout } from "../lib/stuck-timeout";
import { ChatProvider } from "../providers/ChatProvider";
import { useProfiles } from "../providers/ProfileProvider";
import { SoundProvider } from "../providers/SoundProvider";
import { VoiceProvider } from "../providers/VoiceProvider";
import { ClientVersionRequired } from "./ClientVersionGate";
import {
  ConnectionRecoveryActions,
  type ConnectionRecoveryActionsProps,
} from "./ConnectionRecoveryActions";
import { ChatScreen } from "./chat/ChatScreen";
import { WorkspaceSwitcherSheet } from "./chat/WorkspaceSwitcherSheet";
import { MembershipGate } from "./MembershipGate";
import { QueryErrorBoundary } from "./QueryErrorBoundary";
import { SetupScreen } from "./SetupScreen";
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
  const config = useQuery(api.server.publicConfig, {});
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

  // Bind the Convex token cache to this Better Auth session. Sign-out resets it
  // synchronously below; this covers an account switch inside one client, where
  // the next transient failure would otherwise serve the previous person's
  // token. The session id is not part of the native session payload, so the
  // user id is the identity here.
  useEffect(() => {
    if (identity !== null) {
      setProviderTokenIdentity(authClient, identity);
    }
  }, [authClient, identity]);

  // A native OAuth finish in the system browser persists a token outside this
  // client's session atom; re-check once that route says the session changed.
  useEffect(
    () =>
      subscribeAuthChanged(() => {
        void session.refetch();
      }),
    [session],
  );

  // Compatibility gate: all hooks above run unconditionally, so returning here
  // is safe even when the config query resolves later.
  const versionPolicy = config?.clientVersion ?? null;
  if (versionPolicy !== null && mobileVersionState(versionPolicy) === "required") {
    return <ClientVersionRequired policy={versionPolicy} />;
  }

  // A fresh instance has no owner to sign in with; claim it first. An older
  // backend omits the field, so this stays false during a mixed rollout.
  if (config?.setupRequired === true) {
    return (
      <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
        <SetupScreen
          profile={profile}
          authClient={authClient}
          onConnectDifferentServer={backToConnect}
        />
      </SafeAreaView>
    );
  }

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
            // The screen leaves either way; a refused write just keeps the
            // saved profile for the next launch.
            void remove(profile.id).catch(() => undefined);
            backToConnect();
          },
        }}
      />
    );
  }

  const user = session.data?.user;
  if (user !== undefined && user !== null) {
    return (
      <SignedInChat
        profile={profile}
        authClient={authClient}
        client={client}
        user={user}
        onSwitchServer={backToConnect}
      />
    );
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

/**
 * Ends the session, reporting a failure in place.
 *
 * Callers hand this to buttons and boundaries that do not await it (`void
 * signOut()`, `<Button onPress={onSignOut}>`), so a rejection would surface as
 * an unhandled rejection on the recovery and join screens. The person gets the
 * same message either way.
 */
function signOutAction(authClient: AuloraAuthClient) {
  return async () => {
    // Clear the Convex token cache before the request so a token refresh that
    // races the sign-out cannot fall back to the account that is leaving.
    resetProviderToken(authClient);
    const result = await authClient.signOut().catch(() => null);
    if (result === null || result.error) {
      Alert.alert(
        "Couldn't sign out",
        result?.error?.message ?? "Check your connection and try again.",
      );
    }
  };
}

/** Deletes the account on the server, reporting a failure in place. */
function deleteAccountAction(authClient: AuloraAuthClient) {
  return async () => {
    const result = await authActionsFromClient(authClient)
      .deleteAccount()
      .catch(() => null);
    if (result === null || result.error) {
      Alert.alert(
        "Couldn't delete account",
        result?.error?.message ?? "Check your connection and try again.",
      );
    }
  };
}

function SignedInChat({
  profile,
  authClient,
  client,
  user,
  onSwitchServer,
}: {
  readonly profile: ServerProfile;
  readonly authClient: AuloraAuthClient;
  readonly client: ConvexReactClient;
  readonly onSwitchServer: () => void;
  readonly user: {
    readonly id: string;
    readonly name?: string | null;
    readonly email?: string | null;
  };
}) {
  const signOut = signOutAction(authClient);
  const deleteAccount = deleteAccountAction(authClient);
  return (
    <QueryErrorBoundary
      client={client}
      onSignOut={() => void signOut()}
      onSwitchServer={onSwitchServer}
    >
      <MembershipGate
        workspaceIconSeed={profile.iconSeed}
        signedInAs={user.email ?? user.name ?? null}
        onSignOut={() => void signOut()}
        onDeleteAccount={deleteAccount}
      >
        <SoundProvider>
          <ChatProvider key={user.id} client={client} userId={user.id}>
            <VoiceProvider client={client} userId={user.id}>
              <ChatScreen
                workspaceName={profile.name}
                ownUserId={user.id}
                ownDisplayName={user.name ?? user.email ?? "You"}
                onSignOut={signOut}
                onDeleteAccount={deleteAccount}
              />
            </VoiceProvider>
          </ChatProvider>
        </SoundProvider>
      </MembershipGate>
    </QueryErrorBoundary>
  );
}
