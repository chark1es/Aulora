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

const encryption = config.encryption ?? {
  mode: "server",
  algorithm: "AES-256-GCM",
  keyVersion: read(env.get("AULORA_ENCRYPTION_KEY_VERSION")) ?? "1",
  provider: read(env.get("AULORA_EKM_PROVIDER")) ?? "local",
};

const document = {
  name: read(env.get("NAME_VALUE")) ?? read(config.name) ?? "Aulora",
  version: read(config.version) ?? "1.0.0",
  apiVersion: typeof config.apiVersion === "number" ? config.apiVersion : 1,
  convexUrl: read(env.get("CONVEX_URL_VALUE")) ?? read(config.convexUrl) ?? "",
  siteUrl: read(env.get("SITE_URL_VALUE")) ?? read(config.siteUrl) ?? "",
  iconSeed: read(config.iconSeed) ?? "aulora:server:default",
  auth: config.auth ?? { local: { enabled: false, signup: false }, providers: [] },
  encryption,
};

process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
