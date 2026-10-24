import type {
  WellKnownAuth,
  WellKnownOAuthProvider,
  WellKnownOidcProvider,
  WellKnownProvider,
} from "@aulora/core";
import { getEkmSettings } from "./ekm";
import { type GroupRoleMap, parseGroupRoleMap } from "./oidc";

/** Version advertised through `server:publicConfig` and the well-known doc. */
export const AULORA_VERSION = "1.3.0";

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

/**
 * Operator toggles for the auth providers offered by `server.publicConfig`.
 * Absent values inherit the deployment environment; `false` hides a provider
 * even when its credentials are present. `local` gates email/password sign-in
 * and takes precedence over `AUTH_LOCAL_ENABLED`.
 */
export interface AuthProviderToggles {
  readonly github?: boolean;
  readonly google?: boolean;
  readonly microsoft?: boolean;
  readonly apple?: boolean;
  readonly oidc?: boolean;
  readonly local?: boolean;
}

/** A provider is offered unless its toggle is explicitly `false`. */
function providerEnabled(
  toggles: AuthProviderToggles | undefined,
  id: "github" | "google" | "microsoft" | "apple" | "oidc",
): boolean {
  return toggles?.[id] !== false;
}

/**
 * Public origin the auth surface is served from (`/api/auth/*`), without a
 * trailing slash; `null` when neither `SITE_URL` nor `CONVEX_SITE_URL` is set.
 */
export function authSiteOrigin(env: Env): string | null {
  const siteUrl = read(env, "SITE_URL") ?? read(env, "CONVEX_SITE_URL");
  return siteUrl === undefined ? null : siteUrl.replace(/\/+$/, "");
}

/**
 * The redirect (callback) URL an identity provider must allow for the given
 * client-id variable, or `null` when the key is not a provider's client id or
 * the site origin is unknown. Built-in social providers use Better Auth's
 * `/callback/<id>`; the generic OIDC provider uses `/oauth2/callback/<id>`.
 */
export function authRedirectUrlForKey(env: Env, key: string): string | null {
  const origin = authSiteOrigin(env);
  if (origin === null) {
    return null;
  }
  if (key === "OIDC_CLIENT_ID") {
    return `${origin}/api/auth/oauth2/callback/oidc`;
  }
  const social = SOCIAL_PROVIDER_DEFINITIONS.find((definition) => definition.clientIdEnv === key);
  return social === undefined ? null : `${origin}/api/auth/callback/${social.id}`;
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
 * True when at least one non-local provider (GitHub/Google/Microsoft/Apple or
 * OIDC) is both fully configured and not switched off. Used as the lock-out
 * guard: email/password sign-in can only be turned off when this is true.
 */
export function hasOtherSignInProvider(env: Env, toggles?: AuthProviderToggles): boolean {
  for (const def of SOCIAL_PROVIDER_DEFINITIONS) {
    const clientId = read(env, def.clientIdEnv);
    const clientSecret = read(env, def.clientSecretEnv);
    if (
      clientId !== undefined &&
      clientSecret !== undefined &&
      providerEnabled(toggles, def.id as "github" | "google" | "microsoft" | "apple")
    ) {
      return true;
    }
  }
  return getOidcSettings(env) !== null && providerEnabled(toggles, "oidc");
}

export interface LocalAuthResolution {
  readonly enabled: boolean;
  /**
   * True when email/password sign-in was asked to turn off but kept on because
   * no other provider could sign anyone in. Prevents an instance lock-out.
   */
  readonly lockoutPrevented: boolean;
}

/**
 * Resolves whether email/password sign-in is on, with precedence
 * instance setting (`toggles.local`) > `AUTH_LOCAL_ENABLED` > default `true`.
 * A request to disable it is refused (reported as `lockoutPrevented`) when no
 * other sign-in provider is configured and enabled, so an operator can never
 * lock themselves out of the instance.
 */
export function resolveLocalAuthEnabled(
  env: Env,
  toggles?: AuthProviderToggles,
): LocalAuthResolution {
  const requested = toggles?.local ?? read(env, "AUTH_LOCAL_ENABLED") !== "false";
  if (requested) {
    return { enabled: true, lockoutPrevented: false };
  }
  if (hasOtherSignInProvider(env, toggles)) {
    return { enabled: false, lockoutPrevented: false };
  }
  return { enabled: true, lockoutPrevented: true };
}

/**
 * Public (secret-free) auth configuration. Safe to return from a query and to
 * publish in `/.well-known/aulora.json`.
 */
export function getPublicAuthConfig(
  env: Env,
  signupEnabled: boolean,
  toggles?: AuthProviderToggles,
): WellKnownAuth {
  const providers: WellKnownProvider[] = [];

  for (const def of SOCIAL_PROVIDER_DEFINITIONS) {
    const clientId = read(env, def.clientIdEnv);
    const clientSecret = read(env, def.clientSecretEnv);
    if (
      clientId !== undefined &&
      clientSecret !== undefined &&
      providerEnabled(toggles, def.id as "github" | "google" | "microsoft" | "apple")
    ) {
      const provider: WellKnownOAuthProvider = {
        id: def.id,
        type: "oauth",
        displayName: def.displayName,
      };
      providers.push(provider);
    }
  }

  const oidc = getOidcSettings(env);
  if (oidc !== null && providerEnabled(toggles, "oidc")) {
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

  const local = resolveLocalAuthEnabled(env, toggles);

  return {
    local: {
      enabled: local.enabled,
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
  // The desktop shell's webview origins (macOS/Linux, Windows). Its session
  // rides on a bearer token, so it must be allowed to call the auth surface.
  origins.add("tauri://localhost");
  origins.add("http://tauri.localhost");
  origins.add("https://tauri.localhost");
  return [...origins];
}

export function getBetterAuthSecret(env: Env): string | undefined {
  return read(env, "BETTER_AUTH_SECRET");
}

/** Content-encryption mode advertised to clients and setup. */
export type EncryptionMode = "server";

export interface EncryptionSettings {
  readonly enabled: boolean;
  readonly mode: EncryptionMode;
  readonly provider: string;
  readonly keyVersion: string;
}

/**
 * Public-safe encryption settings. `AULORA_ENCRYPTION_ENABLED` defaults to on
 * and is disabled only by the exact value `"false"`. Provider and key version
 * are delegated to the EKM settings; no secret is returned.
 */
export function getEncryptionSettings(env: Env): EncryptionSettings {
  const ekm = getEkmSettings(env);
  return {
    enabled: read(env, "AULORA_ENCRYPTION_ENABLED") !== "false",
    mode: "server",
    provider: ekm.provider,
    keyVersion: ekm.keyVersion,
  };
}
