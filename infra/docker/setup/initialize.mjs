// Calls POST /setup/initialize and prints the HTTP status code.
//
//   node initialize.mjs <response-file>
//
// The response body is written to the given file (never to stdout) so the
// caller can distinguish a retryable "already initialized" error without ever
// logging request or response data. The password is read from the environment
// and never printed.

import { writeFileSync } from "node:fs";

// Snapshot the environment once and read through a Map, so no undeclared
// variable is referenced directly.
const env = new Map(Object.entries(process.env));
const base = env.get("CONVEX_HTTP_URL") ?? "http://convex-backend:3211";
const outFile = process.argv[2];
const token = env.get("SETUP_TOKEN");
const name = env.get("WORKSPACE_NAME");
const email = env.get("OWNER_EMAIL");
const password = env.get("OWNER_PASSWORD");
const displayName = env.get("OWNER_NAME");

if (!outFile || !token || !name || !email || !password) {
  process.stderr.write(
    "initialize.mjs: missing SETUP_TOKEN/WORKSPACE_NAME/OWNER_EMAIL/OWNER_PASSWORD\n",
  );
  process.exit(2);
}

const body = { setupToken: token, name, email, password };
if (displayName) {
  body.displayName = displayName;
}

try {
  const response = await fetch(`${base}/setup/initialize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  writeFileSync(outFile, await response.text(), "utf8");
  process.stdout.write(String(response.status));
} catch {
  process.stderr.write("initialize.mjs: request failed\n");
  process.exit(1);
}
