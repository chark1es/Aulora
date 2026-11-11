import type { ServerProfile } from "@aulora/core";
import { type AuthClient, ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createConnectionRecovery } from "../lib/connection-recovery";
import { useConvexConnectionLog, useRemountLog } from "../lib/remount-debug";
import { createSessionClients, type SessionClients } from "../lib/session-clients";
import { SessionGate } from "./SessionGate";

/**
 * Authenticated Convex session for one server profile. The Convex client and
 * Better Auth client are rebuilt when both should match the active profile’s
 * `convexUrl` and `siteUrl` from its well-known document, and again whenever
 * recovery decides the current pair is dead (see `connection-recovery.ts`).
 *
 * Recovery has to happen here rather than inside the session screens: the
 * clients outlive them, and a Convex client that lost its auth token never asks
 * for another one on its own, so remounting a screen against it changes
 * nothing. This component stays mounted across a rebuild and owns the backoff.
 */
export function ProfileSession({ profile }: { readonly profile: ServerProfile }) {
  const [generation, setGeneration] = useState(0);
  useRemountLog("ProfileSession");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` is the rebuild signal, and the clients only depend on the server’s two URLs
  const clients = useMemo(
    () => createSessionClients(profile),
    [profile.convexUrl, profile.siteUrl, generation],
  );
  useConvexConnectionLog(clients.convex);
  const reset = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);
  const connection = useMemo(() => createConnectionRecovery({ reset }), [reset]);
  useEffect(
    () => () => {
      connection.dispose();
    },
    [connection],
  );
  useDisposeSuperseded(clients);

  return (
    <ConvexBetterAuthProvider
      // A new key discards the provider’s own auth state (token cache, the
      // server’s last answer) instead of carrying it into the rebuilt client.
      key={generation}
      client={clients.convex}
      // The provider’s `AuthClient` prop erases plugin generics (`useSession`
      // collapses to `never`), which our concrete client doesn’t match. Narrow
      // only for the prop; runtime is unchanged. `providerAuthClient` is the
      // same client with an outage-tolerant `convex.token`.
      authClient={clients.providerAuthClient as unknown as AuthClient}
    >
      <SessionGate
        profile={profile}
        authClient={clients.authClient}
        client={clients.convex}
        connection={connection}
      />
    </ConvexBetterAuthProvider>
  );
}

/**
 * Disposes replaced clients once React has committed the replacement, and on a
 * real unmount. The deferral matters: StrictMode mounts, unmounts and remounts
 * a component before a microtask runs, and closing the clients in that probe
 * would leave the re-used ones dead.
 */
function useDisposeSuperseded(clients: SessionClients): void {
  const current = useRef(clients);
  const previous = useRef<SessionClients | undefined>(undefined);
  const mounted = useRef(false);
  current.current = clients;

  useEffect(() => {
    const superseded = previous.current;
    previous.current = clients;
    superseded?.dispose();
  }, [clients]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) {
          current.current.dispose();
        }
      });
    };
  }, []);
}
