/**
 * Convex auth providers. The Better Auth provider is always present. A second
 * `customJwt` provider accepts the short-lived bot JWTs, but only while
 * `BOT_JWT_PUBLIC_JWK` is set, so the feature stays dormant in deployments that
 * have not run bot setup. The JWKS is embedded as a data URI (supported by
 * Convex) to avoid an extra network fetch. See `docs/bots-design.md`.
 */
import { BOT_JWT_ALGORITHM, BOT_JWT_AUDIENCE, BOT_JWT_ISSUER } from "@aulora/core";
import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig, AuthProvider } from "convex/server";

/** The bot provider as a list: empty when the public key is absent or malformed. */
function botProviders(): AuthProvider[] {
  const publicJwk = (process.env.BOT_JWT_PUBLIC_JWK ?? "").trim();
  if (publicJwk.length === 0) {
    return [];
  }
  try {
    const key = JSON.parse(publicJwk);
    const jwks = `data:text/plain;charset=utf-8;base64,${btoa(JSON.stringify({ keys: [key] }))}`;
    return [
      {
        type: "customJwt",
        applicationID: BOT_JWT_AUDIENCE,
        issuer: BOT_JWT_ISSUER,
        jwks,
        algorithm: BOT_JWT_ALGORITHM,
      },
    ];
  } catch {
    // Fail closed: a malformed key must not register a provider that can never
    // verify a token, and must never break the whole auth config.
    return [];
  }
}

const bot = botProviders();

export default {
  providers: [getAuthConfigProvider(), ...bot],
} satisfies AuthConfig;
