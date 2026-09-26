import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { type CookieStore, createCookieFetch, storeRedirectCookie } from "./cookie-fetch";

/**
 * Better Auth client for one server profile on iOS/Android.
 *
 * The backend `auth` block from `/.well-known/aulora.json` drives which methods
 * appear; no provider is hardcoded. Sessions are cookies, so a
 * {@link createCookieFetch} wrapper persists them (React Native has no cookie
 * jar) in the same AsyncStorage the profile store uses.
 */
export function createAuloraAuthClient(siteUrl: string, cookieStore: CookieStore) {
  return createAuthClient({
    baseURL: siteUrl,
    plugins: [convexClient(), genericOAuthClient()],
    fetchOptions: { customFetchImpl: createCookieFetch({ store: cookieStore }) },
  });
}

export type AuloraAuthClient = ReturnType<typeof createAuloraAuthClient>;

export interface AuthActionResult {
  readonly error: { readonly message?: string } | null;
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

/** Local email/password actions driven by the server's `auth.local` block. */
export interface AuthActions {
  signInEmail(input: { email: string; password: string }): Promise<AuthActionResult>;
  signUpEmail(input: { email: string; password: string; name: string }): Promise<AuthActionResult>;
  signOut(): Promise<AuthActionResult>;
}

export function authActionsFromClient(client: AuloraAuthClient): AuthActions {
  return {
    async signInEmail({ email, password }) {
      return toResult(await client.signIn.email({ email, password }));
    },
    async signUpEmail({ email, password, name }) {
      return toResult(await client.signUp.email({ email, password, name }));
    },
    async signOut() {
      return toResult(await client.signOut());
    },
  };
}

/** The deep link Better Auth sends the browser back to. */
export function authRedirectUri(): string {
  return Linking.createURL("auth/callback");
}

export type ProviderSignInResult =
  | { readonly status: "success" }
  | { readonly status: "cancel" }
  | { readonly status: "error"; readonly message: string };

/**
 * Authorization Code + PKCE in the system browser.
 *
 * The client asks the backend's generic OAuth/OIDC plugin for the provider
 * authorization URL (the backend holds the PKCE verifier and the client secret,
 * per the self-hosted design), opens it in the system browser, and captures the
 * `aulora://auth/callback` redirect. Better Auth then appends the session
 * cookie to that redirect, which {@link storeRedirectCookie} persists.
 */
export async function startProviderSignIn(
  client: AuloraAuthClient,
  cookieStore: CookieStore,
  providerId: string,
  type: "oauth" | "oidc",
): Promise<ProviderSignInResult> {
  const redirectUri = authRedirectUri();
  const result =
    type === "oidc"
      ? await client.signIn.oauth2({
          providerId,
          callbackURL: redirectUri,
          disableRedirect: true,
        })
      : await client.signIn.social({
          provider: providerId,
          callbackURL: redirectUri,
          disableRedirect: true,
        });

  const envelope = result as {
    data?: { url?: string } | null;
    error?: { message?: string } | null;
  };
  if (envelope.error) {
    return { status: "error", message: envelope.error.message ?? "Sign-in failed." };
  }
  const url = envelope.data?.url;
  if (url === undefined) {
    return { status: "error", message: "The server did not return an authorization URL." };
  }

  const session = await WebBrowser.openAuthSessionAsync(url, redirectUri);
  if (session.type === "cancel" || session.type === "dismiss") {
    return { status: "cancel" };
  }
  if (session.type === "success" && session.url !== undefined) {
    await storeRedirectCookie(cookieStore, session.url);
    await client.getSession();
    return { status: "success" };
  }
  return { status: "error", message: "Sign-in did not complete." };
}
