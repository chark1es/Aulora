import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * Writes `public/.well-known/aulora.json` for local development only.
 *
 * The document is public by design: it carries the workspace name, icon seed,
 * versions, the Convex URL and the enabled auth providers, and never a secret.
 * It is gitignored; the infra wave (another team) generates the real per-instance
 * document and mounts it over this path in the web container.
 *
 * Environment (all optional, safe local defaults):
 *   INSTANCE_NAME            workspace name                       (Aulora)
 *   SITE_URL                 public web origin                    (http://localhost:5173)
 *   CONVEX_URL               Convex API URL                      (http://127.0.0.1:3210)
 *   AULORA_VERSION           client/instance version             (0.1.0)
 *   API_VERSION              well-known shape version            (1)
 *   ICON_SEED                avatar seed for the workspace       (aulora:server:local)
 *   AUTH_LOCAL_ENABLED       local email/password                (true)
 *   AUTH_LOCAL_SIGNUP        allow local sign-up                 (true)
 *   GITHUB_CLIENT_ID/SECRET, GOOGLE_*, MICROSOFT_*, APPLE_*      built-in OAuth
 *   OIDC_ISSUER/OIDC_DISCOVERY_URL/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET/OIDC_DISPLAY_NAME/OIDC_SCOPES
 *
 * Secrets are only checked for presence to mirror `@aulora/convex`; their values
 * are never read into the output.
 */

type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

function readBoolean(env: Env, name: string, fallback: boolean): boolean {
  const raw = read(env, name);
  if (raw === undefined) {
    return fallback;
  }
  return raw !== "false";
}

function readInt(env: Env, name: string, fallback: number): number {
  const raw = read(env, name);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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

interface OAuthProvider {
  readonly id: string;
  readonly type: "oauth";
  readonly displayName: string;
}

interface OidcProvider {
  readonly id: string;
  readonly type: "oidc";
  readonly displayName: string;
  readonly issuer: string;
  readonly discoveryUrl: string;
  readonly clientId: string;
  readonly scopes: string[];
}

function buildProviders(env: Env): Array<OAuthProvider | OidcProvider> {
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

export function buildWellKnown(env: Env): Record<string, unknown> {
  return {
    name: read(env, "INSTANCE_NAME") ?? "Aulora",
    version: read(env, "AULORA_VERSION") ?? "0.1.0",
    apiVersion: readInt(env, "API_VERSION", 1),
    convexUrl: read(env, "CONVEX_URL") ?? "http://127.0.0.1:3210",
    siteUrl: read(env, "SITE_URL") ?? "http://localhost:5173",
    iconSeed: read(env, "ICON_SEED") ?? "aulora:server:local",
    auth: {
      local: {
        enabled: readBoolean(env, "AUTH_LOCAL_ENABLED", true),
        signup: readBoolean(env, "AUTH_LOCAL_SIGNUP", true),
      },
      providers: buildProviders(env),
    },
  };
}

async function main(): Promise<void> {
  const outputPath = resolve(process.cwd(), "public/.well-known/aulora.json");
  const document = buildWellKnown(process.env);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  process.stdout.write(`wrote ${outputPath}\n`);
}

void main();
