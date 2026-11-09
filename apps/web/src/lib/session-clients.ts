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

import { CONVEX_AUTH_CLIENT_OPTIONS, type ServerProfile } from "@aulora/core";
import { ConvexReactClient } from "convex/react";
import { type AuloraAuthClient, createAuloraAuthClient } from "./auth-client";
import { createProviderAuth } from "./provider-auth";

export interface SessionClients {
  readonly convex: ConvexReactClient;
  readonly authClient: AuloraAuthClient;
  /**
   * The auth client the Convex provider should use: the same session, with a
   * token call that keeps the last token across a transient auth outage.
   */
  readonly providerAuthClient: AuloraAuthClient;
  /** Closes the websocket and drops every subscription. Safe to call twice. */
  dispose(): void;
}

export function createSessionClients(profile: ServerProfile): SessionClients {
  const convex = new ConvexReactClient(profile.convexUrl, CONVEX_AUTH_CLIENT_OPTIONS);
  const authClient = createAuloraAuthClient(profile.siteUrl);
  const providerAuth = createProviderAuth(authClient);
  let disposed = false;
  return {
    convex,
    authClient,
    providerAuthClient: providerAuth.client,
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
