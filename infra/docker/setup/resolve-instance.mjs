// Resolves the instance name/secret from the running Convex backend.
//
//   node resolve-instance.mjs name    -> instance name
//   node resolve-instance.mjs secret  -> instance secret (never logged)
//
// Prefers the backend's own reported values so the admin key, the Postgres
// database name and the deployment all agree, then falls back to the compose
// environment and finally to the persisted credentials file.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const base = process.env.CONVEX_SELF_HOSTED_URL ?? "http://convex-backend:3210";
const field = process.argv[2];

async function fromBackend(name) {
  try {
    const response = await fetch(`${base}/${name}`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) {
      return "";
    }
    return (await response.text()).trim();
  } catch {
    return "";
  }
}

function fromFile(file) {
  try {
    return existsSync(file) ? readFileSync(file, "utf8").trim() : "";
  } catch {
    return "";
  }
}

const dataDir = process.env.DATA_DIR ?? "/convex/data";
const credentialsDir = join(dataDir, "credentials");

if (field === "name") {
  const value =
    (await fromBackend("instance_name")) ||
    (process.env.INSTANCE_NAME ?? "").trim() ||
    fromFile(join(credentialsDir, "instance_name")) ||
    "aulora";
  process.stdout.write(value);
} else if (field === "secret") {
  const value =
    (await fromBackend("instance_secret")) ||
    (process.env.INSTANCE_SECRET ?? "").trim() ||
    fromFile(join(credentialsDir, "instance_secret"));
  process.stdout.write(value);
} else {
  process.stderr.write("usage: resolve-instance.mjs <name|secret>\n");
  process.exit(2);
}
