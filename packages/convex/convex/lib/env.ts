import {
  OWNER_PASSWORD_MIN_LENGTH,
  parseSemver,
  type WellKnownAuth,
  type WellKnownOAuthProvider,
  type WellKnownOidcProvider,
  type WellKnownProvider,
} from "@aulora/core";
import { getEkmSettings } from "./ekm";
import { type GroupRoleMap, parseGroupRoleMap } from "./oidc";

/** Version advertised through `server:publicConfig` and the well-known doc. */
export const AULORA_VERSION = "1.5.0";

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

/**
 * The effective local password minimum: `AUTH_MIN_PASSWORD_LENGTH` clamped to
 * 1–128, defaulting to the shared owner floor (8). Used by Better Auth, the
 * setup action and the public config so all three agree.
 */
export function getMinPasswordLength(env: Env): number {
  const raw = env.AUTH_MIN_PASSWORD_LENGTH;
  const parsed = Number(raw);
  if (raw === undefined || raw.trim().length === 0 || !Number.isFinite(parsed)) {
    return OWNER_PASSWORD_MIN_LENGTH;
  }
  return Math.min(128, Math.max(1, Math.floor(parsed)));
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
 * publish in `/.well-known/aulora.json`, except that the discovery route strips
 * `minPasswordLength`: older strict parsers reject unknown `auth.local` keys.
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
      // Live config only: the discovery route strips this key because older
      // strict parsers reject unknown `auth.local` fields. Clients fall back
      // to 8 when it is absent.
      minPasswordLength: getMinPasswordLength(env),
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

/**
 * Client compatibility policy advertised through `server.publicConfig`.
 * Both settings are optional; absent (or an invalid version) means no minimum
 * and no recommendation, so existing deployments keep their behaviour. The
 * client compares these against its own injected version.
 */
export interface ClientVersionPolicy {
  readonly minClientVersion: string | null;
  readonly recommendedClientVersion: string | null;
}

function versionSetting(env: Env, name: string): string | null {
  const value = read(env, name);
  return value !== undefined && parseSemver(value) !== null ? value : null;
}

export function getClientVersionPolicy(env: Env): ClientVersionPolicy {
  return {
    minClientVersion: versionSetting(env, "AULORA_MIN_CLIENT_VERSION"),
    recommendedClientVersion: versionSetting(env, "AULORA_RECOMMENDED_CLIENT_VERSION"),
  };
}

/** Default lifetime of a minted TURN credential, in seconds. */
export const TURN_DEFAULT_TTL_SECONDS = 3_600;
/** Lower bound that keeps a credential usable long enough to gather a candidate. */
export const TURN_MIN_TTL_SECONDS = 60;
/** Upper bound; coturn itself caps `static-auth-secret` lifetimes at 24h. */
export const TURN_MAX_TTL_SECONDS = 86_400;

/**
 * Default time a participant may stay alone in a call before the backend
 * disconnects them, in seconds. An unusable override falls back to this value
 * rather than disabling the feature, so a typo never strands a solo caller.
 */
export const CALL_ALONE_TIMEOUT_SECONDS_DEFAULT = 300;
/** Lower bound: long enough that a reconnect blip cannot trip it. */
export const CALL_ALONE_TIMEOUT_MIN_SECONDS = 60;
/** Upper bound: a day. */
export const CALL_ALONE_TIMEOUT_MAX_SECONDS = 86_400;

/**
 * Reads the solo-call auto-disconnect timeout. The value is an overridable
 * environment setting; an unset or unusable value keeps the five-minute
 * default.
 */
export function getCallAloneTimeoutSeconds(env: Env): number {
  const raw = read(env, "AULORA_CALL_ALONE_TIMEOUT_SECONDS");
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) &&
    parsed >= CALL_ALONE_TIMEOUT_MIN_SECONDS &&
    parsed <= CALL_ALONE_TIMEOUT_MAX_SECONDS
    ? parsed
    : CALL_ALONE_TIMEOUT_SECONDS_DEFAULT;
}

export interface TurnSettings {
  /** `turn:`/`turns:` URLs clients try, in order. */
  readonly urls: readonly string[];
  /** Coturn `static-auth-secret`, used only to sign time-limited usernames. */
  readonly secret: string;
  readonly ttlSeconds: number;
}

const TURN_URL_PATTERN = /^turns?:\S+$/i;

/**
 * Reads the deployment's TURN relay settings. Returns `null` unless the URLs and
 * a non-trivial shared secret are configured, so a workspace without a TURN
 * server keeps the client's public-STUN default. An unusable `TURN_TTL_SECONDS`
 * falls back to the default rather than disabling the relay.
 */
export function getTurnSettings(env: Env): TurnSettings | null {
  const rawUrls = read(env, "TURN_URLS");
  const secret = read(env, "TURN_SECRET");
  // A short shared secret is a weak HMAC key; refuse it rather than mint
  // credentials anyone could forge.
  if (rawUrls === undefined || secret === undefined || secret.length < 16) {
    return null;
  }
  const urls = rawUrls.split(/[\s,]+/).filter((url) => url.length > 0);
  if (urls.length === 0 || urls.some((url) => !TURN_URL_PATTERN.test(url))) {
    return null;
  }
  const rawTtl = read(env, "TURN_TTL_SECONDS");
  const parsed = rawTtl === undefined ? Number.NaN : Number(rawTtl);
  const ttlSeconds =
    Number.isInteger(parsed) && parsed >= TURN_MIN_TTL_SECONDS && parsed <= TURN_MAX_TTL_SECONDS
      ? parsed
      : TURN_DEFAULT_TTL_SECONDS;
  return { urls, secret, ttlSeconds };
}
