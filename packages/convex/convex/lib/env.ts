import type {
  WellKnownAuth,
  WellKnownOAuthProvider,
  WellKnownOidcProvider,
  WellKnownProvider,
} from "@aulora/core";
import { type GroupRoleMap, parseGroupRoleMap } from "./oidc";

/** Version advertised through `server:publicConfig` and the well-known doc. */
export const AULORA_VERSION = "0.1.0";

/** Shape version of the public config / well-known document. */
export const API_VERSION = 1;

export type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

export interface SocialProviderDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly clientIdEnv: string;
  readonly clientSecretEnv: string;
}

/** Built-in OAuth providers; each appears only when both env vars are set. */
export const SOCIAL_PROVIDER_DEFINITIONS: readonly SocialProviderDefinition[] = [
  {
    id: "github",
    displayName: "GitHub",
    clientIdEnv: "GITHUB_CLIENT_ID",
    clientSecretEnv: "GITHUB_CLIENT_SECRET",
  },
  {
    id: "google",
    displayName: "Google",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
  },
  {
    id: "microsoft",
    displayName: "Microsoft",
    clientIdEnv: "MICROSOFT_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_CLIENT_SECRET",
  },
  {
    id: "apple",
    displayName: "Apple",
    clientIdEnv: "APPLE_CLIENT_ID",
    clientSecretEnv: "APPLE_CLIENT_SECRET",
  },
] as const;

export interface SocialProviderCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Provider id -> credentials for the ones fully configured. */
export function getSocialProviderCredentials(env: Env): Record<string, SocialProviderCredentials> {
  const result: Record<string, SocialProviderCredentials> = {};
  for (const def of SOCIAL_PROVIDER_DEFINITIONS) {
    const clientId = read(env, def.clientIdEnv);
    const clientSecret = read(env, def.clientSecretEnv);
    if (clientId !== undefined && clientSecret !== undefined) {
      result[def.id] = { clientId, clientSecret };
    }
  }
  return result;
}

export interface OidcSettings {
  readonly providerId: string;
  readonly displayName: string;
  readonly issuer: string;
  readonly discoveryUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scopes: readonly string[];
  readonly groupClaim: string | undefined;
  readonly groupRoleMap: GroupRoleMap;
}

function parseScopes(raw: string | undefined): string[] {
  if (raw === undefined) {
    return ["openid", "profile", "email"];
  }
  const scopes = raw
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
  return scopes.length > 0 ? scopes : ["openid", "profile", "email"];
}

/**
 * Generic OIDC provider (Keycloak, Authentik, Authelia, Okta, Zitadel,
 * Entra ID, ...) configured through a discovery URL. Returns `null` unless
 * every required variable is present.
 */
export function getOidcSettings(env: Env): OidcSettings | null {
  const issuer = read(env, "OIDC_ISSUER");
  const discoveryUrl = read(env, "OIDC_DISCOVERY_URL");
  const clientId = read(env, "OIDC_CLIENT_ID");
  const clientSecret = read(env, "OIDC_CLIENT_SECRET");
  if (
    issuer === undefined ||
    discoveryUrl === undefined ||
    clientId === undefined ||
    clientSecret === undefined
  ) {
    return null;
  }
  return {
    providerId: "oidc",
    displayName: read(env, "OIDC_DISPLAY_NAME") ?? "SSO",
    issuer,
    discoveryUrl,
    clientId,
    clientSecret,
    scopes: parseScopes(read(env, "OIDC_SCOPES")),
    groupClaim: read(env, "OIDC_GROUP_CLAIM"),
    groupRoleMap: parseGroupRoleMap(read(env, "OIDC_GROUP_ROLE_MAP")),
  };
}

/**
 * Public (secret-free) auth configuration. Safe to return from a query and to
 * publish in `/.well-known/aulora.json`.
 */
export function getPublicAuthConfig(env: Env, signupEnabled: boolean): WellKnownAuth {
  const providers: WellKnownProvider[] = [];

  for (const def of SOCIAL_PROVIDER_DEFINITIONS) {
    const clientId = read(env, def.clientIdEnv);
    const clientSecret = read(env, def.clientSecretEnv);
    if (clientId !== undefined && clientSecret !== undefined) {
      const provider: WellKnownOAuthProvider = {
        id: def.id,
        type: "oauth",
        displayName: def.displayName,
      };
      providers.push(provider);
    }
  }

  const oidc = getOidcSettings(env);
  if (oidc !== null) {
    const provider: WellKnownOidcProvider = {
      id: oidc.providerId,
      type: "oidc",
      displayName: oidc.displayName,
      issuer: oidc.issuer,
      discoveryUrl: oidc.discoveryUrl,
      clientId: oidc.clientId,
      scopes: [...oidc.scopes],
    };
    providers.push(provider);
  }

  return {
    local: {
      enabled: read(env, "AUTH_LOCAL_ENABLED") !== "false",
      signup: signupEnabled,
    },
    providers,
  };
}

/**
 * Origins Better Auth accepts for callbacks. Native clients use Authorization
 * Code + PKCE and return through the `aulora://auth/callback` deep link, so
 * the custom scheme must be trusted as well as the public site origin.
 */
export function getTrustedOrigins(env: Env): string[] {
  const origins = new Set<string>();
  const extra = read(env, "TRUSTED_ORIGINS");
  if (extra !== undefined) {
    for (const origin of extra.split(",")) {
      const trimmed = origin.trim();
      if (trimmed.length > 0) {
        origins.add(trimmed);
      }
    }
  }
  const siteUrl = read(env, "SITE_URL") ?? read(env, "CONVEX_SITE_URL");
  if (siteUrl !== undefined) {
    origins.add(siteUrl);
  }
  origins.add("aulora://auth/callback");
  origins.add("aulora://");
  return [...origins];
}

export function getBetterAuthSecret(env: Env): string | undefined {
  return read(env, "BETTER_AUTH_SECRET");
}
