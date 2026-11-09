import { AUTH_ENV_VARS } from "./envCatalogAuth";
import { DEPLOYMENT_ENV_VARS } from "./envCatalogDeployment";
import { INSTANCE_ENV_VARS } from "./envCatalogInstance";

/**
 * Single typed catalog of every environment variable the app reads. Pure data:
 * no Convex context, no `process.env`. The instance admin panel renders it and
 * the override mutation validates against it, so a key absent here can never be
 * written; `overridable: false` keys are either dangerous/bootstrap-critical or
 * managed by one of the other admin sections (`managedInSection`).
 */

export type EnvVarGroup =
  | "auth-providers"
  | "oidc"
  | "local-auth"
  | "email"
  | "push"
  | "web-push"
  | "uploads"
  | "tuning"
  | "calls"
  | "updates"
  | "licensing"
  | "deployment";

export type EnvVarType = "string" | "url" | "number" | "boolean" | "enum" | "list" | "json";

/** Extra structural checks for JSON values that are not plain objects. */
export type EnvVarFormat = "ice-servers" | "group-role-map";

/** Admin section that owns a value when it is not editable in Environment. */
export type EnvVarManagedSection = "Email" | "Push relay" | "Storage";

/**
 * Where a variable belongs in the deployment's configuration surface.
 *
 * - `bootstrap`: required before the database, auth or encryption path can
 *   serve a request. It stays in `infra/docker/.env` on a fresh install.
 * - `deploy-time`: read at deploy, module load or container start (auth config,
 *   EKM cron selection, updater, bot keys, tuning). It stays in the deployment
 *   environment because a running deployment cannot change it live.
 * - `overridable`: the owner can set, replace or clear it from Instance admin →
 *   Environment. It is intentionally absent from the default `.env.example`,
 *   and a deployment value is still supported when an operator sets one.
 */
export type EnvVarTier = "bootstrap" | "deploy-time" | "overridable";

/**
 * Non-overridable variables that must exist before the instance can start.
 * Remote-key-manager credentials are bootstrap because the server needs them to
 * unwrap the master key before it can read sealed rows.
 */
export const BOOTSTRAP_ENV_KEYS: readonly string[] = [
  "BETTER_AUTH_SECRET",
  "SETUP_TOKEN",
  "INSTANCE_SECRET",
  "SITE_URL",
  "CONVEX_SITE_URL",
  "CONVEX_CLOUD_URL",
  "TRUSTED_ORIGINS",
  "AULORA_ENCRYPTION_ENABLED",
  "AULORA_ENCRYPTION_KEY",
  "AULORA_KEK_WRAPPED",
  "VAULT_ADDR",
  "VAULT_TOKEN",
  "AWS_KMS_KEY_ID",
  "GCP_KMS_KEY_NAME",
  "EKM_PROXY_URL",
  "EKM_PROXY_TOKEN",
];

/** Deploy-time values that a running deployment cannot change without a redeploy. */
export const DEPLOY_TIME_ENV_KEYS: readonly string[] = [
  "AULORA_EKM_PROVIDER",
  "AULORA_EKM_KEY_ID",
  "AULORA_ENCRYPTION_KEY_VERSION",
  "BOT_JWT_PUBLIC_JWK",
  "BOT_JWT_PRIVATE_JWK",
  "BOT_RUNNER_TOKEN",
];

export interface EnvVarDefinition {
  readonly key: string;
  readonly group: EnvVarGroup;
  readonly tier: EnvVarTier;
  readonly label: string;
  readonly description: string;
  readonly type: EnvVarType;
  readonly secret: boolean;
  readonly overridable: boolean;
  readonly enumValues?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  readonly format?: EnvVarFormat;
  readonly managedInSection?: EnvVarManagedSection;
}

/** Sidebar grouping for the Environment section, in display order. */
export const ENV_VAR_GROUPS: readonly { readonly id: EnvVarGroup; readonly label: string }[] = [
  { id: "auth-providers", label: "Auth providers" },
  { id: "oidc", label: "Single sign-on (OIDC)" },
  { id: "local-auth", label: "Local auth" },
  { id: "email", label: "Email" },
  { id: "push", label: "Push relay" },
  { id: "web-push", label: "Web push" },
  { id: "uploads", label: "Uploads" },
  { id: "tuning", label: "Rate limits" },
  { id: "calls", label: "Calls & streaming" },
  { id: "updates", label: "Updates" },
  { id: "licensing", label: "Licensing" },
  { id: "deployment", label: "Deployment & security" },
];

/** The catalog itself: one entry per environment variable the app reads. */
export const ENV_VAR_CATALOG: readonly EnvVarDefinition[] = [
  ...AUTH_ENV_VARS,
  ...INSTANCE_ENV_VARS,
  ...DEPLOYMENT_ENV_VARS,
];

const definitionsByKey = new Map(ENV_VAR_CATALOG.map((definition) => [definition.key, definition]));

/** The four variables required for the generic OIDC provider to be offered. */
export const OIDC_REQUIRED_ENV_KEYS: readonly string[] = [
  "OIDC_ISSUER",
  "OIDC_DISCOVERY_URL",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
];

/**
 * Variables that only make sense together and must come from one source. If
 * the owner overrides any key in a group, the group's other keys stop
 * inheriting the deployment value, so a deployment secret can never be paired
 * with an endpoint or client id the owner chose (which would hand the secret
 * to a server of their choosing).
 */
export const ENV_CREDENTIAL_GROUPS: readonly (readonly string[])[] = [
  OIDC_REQUIRED_ENV_KEYS,
  ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
  ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
  ["APPLE_CLIENT_ID", "APPLE_CLIENT_SECRET"],
];

export function findEnvVarDefinition(key: string): EnvVarDefinition | undefined {
  return definitionsByKey.get(key);
}

/** True when a key may be written from the instance admin UI. */
export function isOverridableEnvVar(key: string): boolean {
  return definitionsByKey.get(key)?.overridable === true;
}

/** True when a key's value must never be returned to a client. */
export function isSecretEnvVar(key: string): boolean {
  return definitionsByKey.get(key)?.secret === true;
}
