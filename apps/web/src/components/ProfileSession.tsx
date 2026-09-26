import type { ServerProfile } from "@aulora/core";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
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
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      <SessionGate profile={profile} authClient={authClient} />
    </ConvexBetterAuthProvider>
  );
}
