import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import {
  authStartUrl,
  beginAuthHandoff,
  clearPendingAuthHandoff,
  completeAuthRedirect,
  exchangeAuthCode,
  isAuthExchangeTimeout,
  providerSignInErrorMessage,
  readAuthRedirectParams,
} from "./auth-handoff";
import { authTokenKey, type CookieStore, createCookieFetch } from "./cookie-fetch";
import { resetProviderToken } from "./provider-auth";

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
    fetchOptions: {
      customFetchImpl: createCookieFetch({ store: cookieStore, tokenKey: authTokenKey(siteUrl) }),
    },
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
  /** Permanently deletes this account on the server, then ends the session. */
  deleteAccount(): Promise<AuthActionResult>;
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
      // Drop the cached Convex token before the request: a token fetch that
      // races the sign-out must not fall back to the account that is leaving.
      resetProviderToken(client);
      return toResult(await client.signOut());
    },
    async deleteAccount() {
      const result = await client.deleteUser({});
      if (result.error) {
        return toResult(result);
      }
      // The server has deleted the account; make this device forget the now
      // invalid session instead of leaving a stale cookie behind.
      resetProviderToken(client);
      await client.signOut().catch(() => undefined);
      return { error: null };
    },
  };
}

/** The deep link Better Auth sends the browser back to. */
export function authRedirectUri(): string {
  return Linking.createURL("auth/callback");
}

export type ProviderDelivery = "in-app" | "external";

export type ProviderSignInResult =
  | { readonly status: "success" }
  | { readonly status: "cancel" }
  | { readonly status: "opened" }
  | { readonly status: "error"; readonly message: string };

/** `aulora://auth/callback` regardless of whether Expo is running in dev. */
function callbackScheme(): string {
  return "aulora://auth/callback";
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A 256-bit verifier; the server only ever sees its SHA-256 digest. */
async function createHandoffVerifier(): Promise<string> {
  return bytesToHex(await Crypto.getRandomBytesAsync(32));
}

/**
 * A 256-bit transaction id, independent of the verifier (the verifier must
 * never leave the install). The workspace echoes this on every redirect back
 * so a link that only names the workspace origin cannot end the sign-in.
 */
async function createAuthTransactionId(): Promise<string> {
  return bytesToHex(await Crypto.getRandomBytesAsync(32));
}

async function handoffChallenge(verifier: string): Promise<string> {
  return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}

/**
 * Authorization Code + PKCE started on the workspace's own origin.
 *
 * Better Auth binds the callback to the browser context that started sign-in
 * with a signed state cookie. A native app has its own cookie jar, separate
 * from the browser, so asking the app's fetch stack for the authorization URL
 * and then finishing in a browser always lost the state cookie. The start URL
 * is a first-party page that begins the flow inside the browser that will
 * receive the callback.
 *
 * `in-app` finishes in `expo-web-browser` (SFSafariViewController / Custom
 * Tabs); `external` opens the system browser and the app is resumed by the
 * `aulora://auth/callback` deep link. Both return a short-lived code that is
 * exchanged for the bearer token kept with {@link storeAuthToken}.
 */
export async function startProviderSignIn(
  client: AuloraAuthClient,
  cookieStore: CookieStore,
  siteUrl: string,
  providerId: string,
  type: "oauth" | "oidc",
  delivery: ProviderDelivery,
): Promise<ProviderSignInResult> {
  const returnUrl = delivery === "in-app" ? authRedirectUri() : callbackScheme();
  let startUrl: string;
  try {
    const verifier = await createHandoffVerifier();
    const tx = await createAuthTransactionId();
    const challenge = await handoffChallenge(verifier);
    await beginAuthHandoff(cookieStore, siteUrl, verifier, tx);
    startUrl = authStartUrl(siteUrl, providerId, type, returnUrl, challenge, tx);
  } catch {
    return { status: "error", message: "Could not start sign-in. Try again." };
  }

  if (delivery === "external") {
    await Linking.openURL(startUrl);
    return { status: "opened" };
  }

  const session = await WebBrowser.openAuthSessionAsync(startUrl, returnUrl);
  if (session.type === "cancel" || session.type === "dismiss") {
    // The person closed the auth sheet: that is not a forged link, so this is
    // the one place a callback-less dismissal ends the pending transaction.
    await clearPendingAuthHandoff(cookieStore).catch(() => undefined);
    return { status: "cancel" };
  }
  if (session.type !== "success" || session.url === undefined) {
    return { status: "error", message: "Sign-in did not complete." };
  }
  const params = readAuthRedirectParams(session.url);
  if (params === null) {
    return { status: "error", message: "Sign-in did not complete." };
  }
  let result: Awaited<ReturnType<typeof completeAuthRedirect>>;
  try {
    result = await completeAuthRedirect(cookieStore, params, exchangeAuthCode);
  } catch (error) {
    return {
      status: "error",
      message: isAuthExchangeTimeout(error)
        ? "Sign-in timed out, please try again"
        : "Could not complete sign-in.",
    };
  }
  if (result.status === "error") {
    return { status: "error", message: providerSignInErrorMessage(result.error) };
  }
  if (result.status !== "success") {
    // A forged or unbound redirect: the pending transaction is untouched, so
    // the browser sheet cannot cancel or finish someone else's sign-in.
    return { status: "error", message: "Sign-in did not complete." };
  }
  await client.getSession();
  return { status: "success" };
}
