import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// `/api/mcp` is a Convex HTTP action (port 3211). A catch-all `/api/` route to
// the client API (3210) would swallow it, so every shipped proxy config must
// route it explicitly.

const dockerDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts) => readFileSync(join(dockerDir, ...parts), "utf8");

test("nginx routes /api/mcp to the HTTP actions port with a 2m body cap", () => {
  const nginx = read("nginx", "default.conf.template");
  const match = /location = \/api\/mcp \{([^}]*)\}/.exec(nginx);
  assert.notEqual(match, null);
  const block = match[1];
  assert.match(block, /proxy_pass http:\/\/convex-backend:3211;/);
  assert.match(block, /client_max_body_size 2m;/);
  assert.match(block, /proxy_read_timeout 120s;/);
});

test("traefik and caddy examples route /api/mcp to 3211", () => {
  const traefik = read("proxy", "traefik.labels.yml");
  assert.match(traefik, /aulora-mcp\.rule: .*Path\(`\/api\/mcp`\)/);
  assert.match(traefik, /aulora-mcp\.service: "aulora-auth"/);
  const caddy = read("proxy", "Caddyfile.example");
  assert.match(caddy, /handle \/api\/mcp \{\s+reverse_proxy convex-backend:3211\s+\}/);
});
