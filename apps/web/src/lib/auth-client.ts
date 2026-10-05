import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import {
  clearSessionToken,
  isCrossOrigin,
  readSessionToken,
  writeSessionToken,
} from "./session-token";

/**
 * Creates a Better Auth client for one server profile.
 *
 * Wiring follows the official Convex + Better Auth React (Vite SPA) guide:
 * https://labs.convex.dev/better-auth/framework-guides/react
 *
 * - `baseURL` is the server's `siteUrl` (the origin the web app is served from),
 *   so `/api/auth/*` is same-origin and the session cookie is first-party. The
 *   reverse proxy forwards that path to the Convex HTTP-actions port.
 * - `convexClient()` exposes `authClient.convex.token()`, which
 *   `ConvexBetterAuthProvider` uses to authenticate Convex.
 * - `genericOAuthClient()` exposes `signIn.oauth2({ providerId })` for the
 *   server's generic OIDC providers.
 * - `credentials: "include"` sends the first-party session cookie.
 * - When the app is not served from `siteUrl` (the desktop app, a dev server on
 *   another port) the cookie is cross-site and does not survive a restart, so
 *   the session token from `set-auth-token` is stored and replayed as a bearer
 *   token. See `./session-token`.
 */
export function createAuloraAuthClient(siteUrl: string) {
  const persistToken = isCrossOrigin(siteUrl);
  return createAuthClient({
    baseURL: siteUrl,
    plugins: [convexClient(), genericOAuthClient()],
    fetchOptions: {
      credentials: "include",
      ...(persistToken
        ? {
            auth: {
              type: "Bearer" as const,
              token: () => readSessionToken(siteUrl) ?? "",
            },
            onSuccess: (context: { request: { url: URL | string }; response: Response }) => {
              if (String(context.request.url).includes("/sign-out")) {
                clearSessionToken(siteUrl);
                return;
              }
              const token = context.response.headers.get("set-auth-token");
              if (token !== null && token.length > 0) {
                writeSessionToken(siteUrl, token);
              }
            },
          }
        : {}),
    },
  });
}

export type AuloraAuthClient = ReturnType<typeof createAuloraAuthClient>;

export interface AuthActionResult {
  readonly error: { readonly message?: string } | null;
}

/** Narrow, test-friendly view of the auth actions the sign-in UI needs. */
export interface AuthActions {
  signInEmail: (_input: { email: string; password: string }) => Promise<AuthActionResult>;
  signUpEmail: (_input: {
    email: string;
    password: string;
    name: string;
  }) => Promise<AuthActionResult>;
  signInSocial: (_input: { provider: string; callbackURL: string }) => Promise<AuthActionResult>;
  signInOAuth2: (_input: { providerId: string; callbackURL: string }) => Promise<AuthActionResult>;
  signOut: () => Promise<AuthActionResult>;
}

function toResult(result: { error?: unknown } | null | undefined): AuthActionResult {
  const error = result?.error;
  if (error === null || error === undefined) {
    return { error: null };
  }
  if (
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return { error: { message: (error as { message: string }).message } };
  }
  return { error: {} };
}

/** Adapts a live client to {@link AuthActions}. */
export function authActionsFromClient(client: AuloraAuthClient): AuthActions {
  return {
    async signInEmail({ email, password }) {
      return toResult(await client.signIn.email({ email, password }));
    },
    async signUpEmail({ email, password, name }) {
      return toResult(await client.signUp.email({ email, password, name }));
    },
    async signInSocial({ provider, callbackURL }) {
      return toResult(await client.signIn.social({ provider, callbackURL }));
    },
    async signInOAuth2({ providerId, callbackURL }) {
      return toResult(await client.signIn.oauth2({ providerId, callbackURL }));
    },
    async signOut() {
      return toResult(await client.signOut());
    },
  };
}
