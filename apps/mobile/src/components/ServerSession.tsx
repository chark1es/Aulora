import type { ServerProfile } from "@aulora/core";
import { CONVEX_AUTH_CLIENT_OPTIONS, createProviderAuth } from "@aulora/core";
import { Button, Text } from "@aulora/ui-native";
import { type AuthClient, ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ConvexReactClient } from "convex/react";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";
import { createAuloraAuthClient } from "../lib/auth-client";
import { type ProfileUrlField, profileUrlProblem } from "../lib/session-profile";
import { ScreenContainer } from "./layout/ScreenContainer";
import { SessionGate } from "./SessionGate";

/**
 * Authenticated Convex session for one server profile. The Convex client and
 * Better Auth client are rebuilt when the active profile’s `convexUrl` and
 * `siteUrl` change, exactly as on web; sessions persist in AsyncStorage.
 */
export function ServerSession({ profile }: { readonly profile: ServerProfile }) {
  const problem = profileUrlProblem(profile);
  const convex = useMemo(
    () =>
      problem === null
        ? new ConvexReactClient(profile.convexUrl, CONVEX_AUTH_CLIENT_OPTIONS)
        : null,
    [problem, profile.convexUrl],
  );
  const authClient = useMemo(
    () => (problem === null ? createAuloraAuthClient(profile.siteUrl, AsyncStorage) : null),
    [problem, profile.siteUrl],
  );
  // Same session, with a `convex.token` that survives a transient outage
  // instead of reporting the person signed out.
  const providerAuth = useMemo(
    () => (authClient === null ? null : createProviderAuth(authClient)),
    [authClient],
  );

  // `ConvexReactClient` throws on an address that is not absolute, and every
  // retry from the route boundary would throw again with no way out. A stored
  // profile the server described badly gets an explanation instead.
  if (problem !== null || convex === null || authClient === null || providerAuth === null) {
    return <ServerAddressProblem profile={profile} field={problem ?? "baseUrl"} />;
  }

  return (
    <ConvexBetterAuthProvider
      client={convex}
      // The provider’s `AuthClient` prop erases plugin generics (`useSession`
      // collapses to `never`), which our browser-cookie client doesn’t match.
      // The runtime contract is identical; narrow only for the prop.
      authClient={providerAuth.client as unknown as AuthClient}
    >
      <SessionGate
        profile={profile}
        authClient={authClient}
        cookieStore={AsyncStorage}
        client={convex}
      />
    </ConvexBetterAuthProvider>
  );
}

const ADDRESS_LABELS: ReadonlyMap<ProfileUrlField, string> = new Map([
  ["baseUrl", "The workspace address"],
  ["convexUrl", "The Convex address this server advertises"],
  ["siteUrl", "The site address this server advertises"],
]);

/**
 * Shown instead of the session when a stored profile cannot be connected to.
 * The person needs a route back to the server list, which a thrown render error
 * cannot give them.
 */
function ServerAddressProblem({
  profile,
  field,
}: {
  readonly profile: ServerProfile;
  readonly field: ProfileUrlField;
}) {
  const router = useRouter();
  const shown =
    field === "convexUrl"
      ? profile.convexUrl
      : field === "siteUrl"
        ? profile.siteUrl
        : profile.baseUrl;
  return (
    <ScreenContainer scrollable className="flex-1 min-w-0">
      <View className="grow items-center justify-center gap-3 px-6 min-w-0">
        <Text size="md" className="text-center font-medium">
          {profile.name} cannot be opened
        </Text>
        <Text size="sm" tone="muted" className="text-center">
          {ADDRESS_LABELS.get(field) ?? "The server address"} is not a full http or https address,
          so this app cannot reach it. Check the address the server publishes, or ask whoever runs
          it.
        </Text>
        <Text size="xs" tone="muted" mono className="text-center">
          {shown}
        </Text>
        <Button
          onPress={() => {
            router.push("/connect");
          }}
        >
          Use a different workspace
        </Button>
      </View>
    </ScreenContainer>
  );
}
