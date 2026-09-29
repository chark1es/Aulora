import type { ServerProfile } from "@aulora/core";
import { type AuthClient, ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";
import { useMemo } from "react";
import { createAuloraAuthClient } from "../lib/auth-client";
import { SessionGate } from "./SessionGate";

/**
 * Authenticated Convex session for one server profile. The Convex client and
 * Better Auth client are rebuilt when both should match the active profile's
 * `convexUrl` and `siteUrl` from its well-known document.
 */
export function ProfileSession({ profile }: { readonly profile: ServerProfile }) {
  const convex = useMemo(() => new ConvexReactClient(profile.convexUrl), [profile.convexUrl]);
  const authClient = useMemo(() => createAuloraAuthClient(profile.siteUrl), [profile.siteUrl]);

  return (
    <ConvexBetterAuthProvider
      client={convex}
      // The provider's `AuthClient` prop erases plugin generics (`useSession`
      // collapses to `never`), which our concrete client doesn't match. Narrow
      // only for the prop; runtime is unchanged.
      authClient={authClient as unknown as AuthClient}
    >
      <SessionGate profile={profile} authClient={authClient} client={convex} />
    </ConvexBetterAuthProvider>
  );
}
