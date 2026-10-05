/** Reads the optional environment that shapes a local `aulora.json`. */
export type Env = Record<string, string | undefined>;

export function read(env: Env, name: string): string | undefined {
  const raw = new Map(Object.entries(env)).get(name);
  if (raw === undefined) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

export function readBoolean(env: Env, name: string, fallback: boolean): boolean {
  const raw = read(env, name);
  if (raw === undefined) {
    return fallback;
  }
  return raw !== "false";
}

export function readInt(env: Env, name: string, fallback: number): number {
  const raw = read(env, name);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

interface SocialDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly clientIdEnv: string;
  readonly clientSecretEnv: string;
}

/** Mirrors `SOCIAL_PROVIDER_DEFINITIONS` in `@aulora/convex`. */
const SOCIAL_DEFINITIONS: readonly SocialDefinition[] = [
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
];

export interface OAuthProvider {
  readonly id: string;
  readonly type: "oauth";
  readonly displayName: string;
}

export interface OidcProvider {
  readonly id: string;
  readonly type: "oidc";
  readonly displayName: string;
  readonly issuer: string;
  readonly discoveryUrl: string;
  readonly clientId: string;
  readonly scopes: string[];
}

export function buildProviders(env: Env): Array<OAuthProvider | OidcProvider> {
  const providers: Array<OAuthProvider | OidcProvider> = [];

  for (const definition of SOCIAL_DEFINITIONS) {
    const clientId = read(env, definition.clientIdEnv);
    const clientSecret = read(env, definition.clientSecretEnv);
    if (clientId !== undefined && clientSecret !== undefined) {
      providers.push({ id: definition.id, type: "oauth", displayName: definition.displayName });
    }
  }

  const issuer = read(env, "OIDC_ISSUER");
  const discoveryUrl = read(env, "OIDC_DISCOVERY_URL");
  const clientId = read(env, "OIDC_CLIENT_ID");
  const clientSecret = read(env, "OIDC_CLIENT_SECRET");
  if (
    issuer !== undefined &&
    discoveryUrl !== undefined &&
    clientId !== undefined &&
    clientSecret !== undefined
  ) {
    providers.push({
      id: read(env, "OIDC_PROVIDER_ID") ?? "oidc",
      type: "oidc",
      displayName: read(env, "OIDC_DISPLAY_NAME") ?? "SSO",
      issuer,
      discoveryUrl,
      clientId,
      scopes: parseScopes(read(env, "OIDC_SCOPES")),
    });
  }

  return providers;
}

function parseScopes(raw: string | undefined): string[] {
  const fallback = ["openid", "profile", "email"];
  if (raw === undefined) {
    return fallback;
  }
  const scopes = raw
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
  return scopes.length > 0 ? scopes : fallback;
}
