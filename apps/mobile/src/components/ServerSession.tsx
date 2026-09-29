import type { ServerProfile } from "@aulora/core";
import { type AuthClient, ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ConvexReactClient } from "convex/react";
import { useMemo } from "react";
import { createAuloraAuthClient } from "../lib/auth-client";
import { SessionGate } from "./SessionGate";

/**
 * Authenticated Convex session for one server profile. The Convex client and
 * Better Auth client are rebuilt when the active profile's `convexUrl` and
 * `siteUrl` change, exactly as on web; sessions persist in AsyncStorage.
 */
export function ServerSession({ profile }: { readonly profile: ServerProfile }) {
  const convex = useMemo(() => new ConvexReactClient(profile.convexUrl), [profile.convexUrl]);
  const authClient = useMemo(
    () => createAuloraAuthClient(profile.siteUrl, AsyncStorage),
    [profile.siteUrl],
  );

  return (
    <ConvexBetterAuthProvider
      client={convex}
      // The provider's `AuthClient` prop erases plugin generics (`useSession`
      // collapses to `never`), which our browser-cookie client doesn't match.
      // The runtime contract is identical; narrow only for the prop.
      authClient={authClient as unknown as AuthClient}
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
