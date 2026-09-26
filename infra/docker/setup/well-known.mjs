// Writes the public, secret-free `/.well-known/aulora.json` document from the
// deployment's `server:publicConfig` output. Reads its inputs from the
// environment so no values appear on the command line (or in process listings).
//
//   PUBLIC_CONFIG  JSON returned by `convex run server:publicConfig '{}'`
//   NAME_VALUE     instance/workspace name
//   SITE_URL_VALUE public web origin
//   CONVEX_URL_VALUE public Convex API origin

const read = (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

let config;
try {
  config = JSON.parse(process.env.PUBLIC_CONFIG ?? "{}");
} catch {
  config = {};
}

const document = {
  name: read(process.env.NAME_VALUE) ?? read(config.name) ?? "Aulora",
  version: read(config.version) ?? "0.1.0",
  apiVersion: typeof config.apiVersion === "number" ? config.apiVersion : 1,
  convexUrl: read(process.env.CONVEX_URL_VALUE) ?? read(config.convexUrl) ?? "",
  siteUrl: read(process.env.SITE_URL_VALUE) ?? read(config.siteUrl) ?? "",
  iconSeed: read(config.iconSeed) ?? "aulora:server:default",
  auth: config.auth ?? { local: { enabled: false, signup: false }, providers: [] },
};

process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
