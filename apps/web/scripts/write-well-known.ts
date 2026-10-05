import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildProviders, type Env, read, readBoolean, readInt } from "./well-known-env";

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
 *   AULORA_EKM_PROVIDER      external key manager provider       (local)
 *   AULORA_ENCRYPTION_KEY_VERSION  content key version            (1)
 *   GITHUB_CLIENT_ID/SECRET, GOOGLE_*, MICROSOFT_*, APPLE_*      built-in OAuth
 *   OIDC_ISSUER/OIDC_DISCOVERY_URL/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET/OIDC_DISPLAY_NAME/OIDC_SCOPES
 *
 * Secrets are only checked for presence to mirror `@aulora/convex`; their values
 * are never read into the output.
 */

export function buildWellKnown(env: Env): Record<string, unknown> {
  return {
    name: read(env, "INSTANCE_NAME") ?? "Aulora",
    version: read(env, "AULORA_VERSION") ?? "1.0.0",
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
    // Non-secret encryption descriptor, mirroring `@aulora/convex`
    // `getEncryptionSettings`; no key material is read or emitted.
    encryption: {
      mode: "server",
      algorithm: "AES-256-GCM",
      keyVersion: read(env, "AULORA_ENCRYPTION_KEY_VERSION") ?? "1",
      provider: read(env, "AULORA_EKM_PROVIDER") ?? "local",
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
