// Writes the public, secret-free `/.well-known/aulora.json` document from the
// deployment's `server:publicConfig` output. Reads its inputs from the
// environment so no values appear on the command line (or in process listings).
//
//   PUBLIC_CONFIG  JSON returned by `convex run server:publicConfig '{}'`
//   NAME_VALUE     instance/workspace name
//   SITE_URL_VALUE public web origin
//   CONVEX_URL_VALUE public Convex API origin
//
// The encryption descriptor is non-secret: it comes from the public config or,
// failing that, from the key-manager env (provider and key version only).

const read = (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

// Snapshot the environment once and read through a Map, so no undeclared
// variable is referenced directly.
const env = new Map(Object.entries(process.env));

let config;
try {
  config = JSON.parse(env.get("PUBLIC_CONFIG") ?? "{}");
} catch {
  config = {};
}

// The encryption descriptor is allowlisted too: a later release may add fields
// that an older strict parser rejects.
const configuredEncryption = config.encryption ?? {};
const encryption = {
  mode: "server",
  algorithm: read(configuredEncryption.algorithm) ?? "AES-256-GCM",
  keyVersion:
    read(configuredEncryption.keyVersion) ??
    read(env.get("AULORA_ENCRYPTION_KEY_VERSION")) ??
    "1",
  provider: read(configuredEncryption.provider) ?? read(env.get("AULORA_EKM_PROVIDER")) ?? "local",
};

// The discovery document's strict key set is part of the API contract older
// clients validate. Rebuild `auth` from the fields the previous release accepts
// instead of copying the live `server.publicConfig` object, which also carries
// newer fields such as `auth.local.minPasswordLength`. A 1.4.0 client rejects an
// unknown key with INVALID_SHAPE, so a server upgrade would strand it.
const OAUTH_KEYS = ["id", "type", "displayName"];
const OIDC_KEYS = ["id", "type", "displayName", "issuer", "discoveryUrl", "clientId", "scopes"];

function pick(object, keys) {
  const result = {};
  for (const key of keys) {
    if (object[key] !== undefined) {
      result[key] = object[key];
    }
  }
  return result;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function knownProvider(provider) {
  if (typeof provider !== "object" || provider === null || Array.isArray(provider)) {
    return undefined;
  }
  if (provider.type === "oauth") {
    if (!isNonEmptyString(provider.id) || !isNonEmptyString(provider.displayName)) {
      return undefined;
    }
    return pick(provider, OAUTH_KEYS);
  }
  if (provider.type === "oidc") {
    for (const key of ["id", "displayName", "issuer", "discoveryUrl", "clientId"]) {
      if (!isNonEmptyString(provider[key])) {
        return undefined;
      }
    }
    if (!Array.isArray(provider.scopes) || provider.scopes.some((scope) => typeof scope !== "string")) {
      return undefined;
    }
    return pick(provider, OIDC_KEYS);
  }
  return undefined;
}

function discoveryAuth(auth) {
  const local = typeof auth?.local === "object" && auth.local !== null ? auth.local : {};
  const providers = Array.isArray(auth?.providers)
    ? auth.providers.map(knownProvider).filter((provider) => provider !== undefined)
    : [];
  return {
    // Only the two fields the strict contract accepts, even when the live
    // config carries more.
    local: { enabled: local.enabled === true, signup: local.signup === true },
    providers,
  };
}

const document = {
  name: read(env.get("NAME_VALUE")) ?? read(config.name) ?? "Aulora",
  version: read(config.version) ?? "1.4.0",
  apiVersion: typeof config.apiVersion === "number" ? config.apiVersion : 1,
  convexUrl: read(env.get("CONVEX_URL_VALUE")) ?? read(config.convexUrl) ?? "",
  siteUrl: read(env.get("SITE_URL_VALUE")) ?? read(config.siteUrl) ?? "",
  iconSeed: read(config.iconSeed) ?? "aulora:server:default",
  auth: discoveryAuth(config.auth),
  encryption,
};

process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
