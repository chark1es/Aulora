/**
 * The Convex and Better Auth clients for one server profile.
 *
 * They are created together and thrown away together. A Convex client owns its
 * websocket, the auth token it was given and the backoff it is currently in; a
 * Better Auth client owns the session snapshot and the token cache in its
 * store. Both keep that state for the life of the instance, so a client that
 * went dead when the server restarted could not be nursed back: it has to be
 * replaced. See `connection-recovery.ts` for when that happens.
 */

import type { ServerProfile } from "@aulora/core";
import { ConvexReactClient } from "convex/react";
import { type AuloraAuthClient, createAuloraAuthClient } from "./auth-client";

export interface SessionClients {
  readonly convex: ConvexReactClient;
  readonly authClient: AuloraAuthClient;
  /** Closes the websocket and drops every subscription. Safe to call twice. */
  dispose(): void;
}

export function createSessionClients(profile: ServerProfile): SessionClients {
  const convex = new ConvexReactClient(profile.convexUrl);
  const authClient = createAuloraAuthClient(profile.siteUrl);
  let disposed = false;
  return {
    convex,
    authClient,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      // Resolves once the socket has closed; nothing here needs to wait for it.
      void convex.close();
    },
  };
}
