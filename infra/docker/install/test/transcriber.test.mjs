import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Guards the optional transcription engine's deployment boundary: it is off by
// default, non-root, read-only, isolated on its own network, and its WebSocket
// route is the only public surface.

const dockerDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repo = join(dockerDir, "..", "..");

// js-yaml is a transitive Bun-store dependency. Resolve it from the store so
// this test parses the real Compose documents instead of scanning text.
async function loadYaml() {
  const store = join(repo, "node_modules", ".bun");
  const entry = readdirSync(store).find((name) => name.startsWith("js-yaml@"));
  assert.ok(entry, "js-yaml is present in the Bun store");
  const module = await import(
    pathToFileURL(join(store, entry, "node_modules", "js-yaml", "index.js")).href
  );
  return module.default ?? module;
}

function serviceNetworks(service) {
  const networks = service.networks;
  if (networks === undefined || networks === null) return [];
  return Array.isArray(networks) ? networks : Object.keys(networks);
}

function serviceBlock(file, name) {
  const lines = readFileSync(join(dockerDir, file), "utf8").split("\n");
  const start = lines.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `${name} is missing from ${file}`);
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {2}[A-Za-z0-9_.-]+:/.test(line) || /^[A-Za-z]/.test(line)) break;
    block.push(line);
  }
  return block.join("\n");
}

for (const file of ["docker-compose.yml", "docker-compose.coolify.yml"]) {
  test(`transcriber is an optional, hardened service in ${file}`, () => {
    const block = serviceBlock(file, "transcriber");
    assert.match(block, /^\s+profiles: \["transcription"\]$/m);
    assert.match(block, /^ {4}restart: unless-stopped$/m);
    assert.match(block, /^ {4}read_only: true$/m);
    assert.match(block, /^ {6}- ALL$/m);
    assert.match(block, /no-new-privileges:true/);
    assert.match(block, /transcriber-models:\/models/);
    assert.match(block, /CONVEX_INGEST_URL: http:\/\/convex-backend:3211\/transcription\/ingest/);
    assert.match(block, /TRANSCRIBER_TOKEN:/);
    assert.match(block, /^\s+- transcription$/m);
    assert.doesNotMatch(block, /^\s+ports:/m);
  });
}

for (const file of ["docker-compose.yml", "docker-compose.coolify.yml"]) {
  test(`web and transcriber share the transcription network in ${file}`, async () => {
    const yaml = await loadYaml();
    const document = yaml.load(readFileSync(join(dockerDir, file), "utf8"));
    const web = document.services.web;
    const transcriber = document.services.transcriber;
    assert.ok(web, `web is missing from ${file}`);
    assert.ok(transcriber, `transcriber is missing from ${file}`);
    const webNetworks = serviceNetworks(web);
    const transcriberNetworks = serviceNetworks(transcriber);
    assert.ok(webNetworks.includes("transcription"), `web joins transcription in ${file}`);
    assert.ok(
      transcriberNetworks.includes("transcription"),
      `transcriber joins transcription in ${file}`,
    );
    assert.ok(
      webNetworks.some((network) => transcriberNetworks.includes(network)),
      `web and transcriber share a network in ${file}`,
    );
    // The audio WebSocket is the only public surface; nothing may publish a
    // host port for the optional engine.
    assert.equal(transcriber.ports, undefined, `transcriber publishes no ports in ${file}`);
    assert.equal(transcriber.expose, undefined, `transcriber exposes no ports in ${file}`);
  });
}

test("the transcriber image runs as a non-root user", () => {
  const dockerfile = readFileSync(join(repo, "infra", "transcriber", "Dockerfile"), "utf8");
  assert.match(dockerfile, /^USER transcriber$/m);
  assert.match(dockerfile, /chown -R transcriber:transcriber \/app \/models \/home\/transcriber/);
  assert.match(dockerfile, /--home-dir \/home\/transcriber/);
  assert.match(dockerfile, /HF_HOME=\/models\/hf-cache/);
  assert.match(dockerfile, /HEALTHCHECK/);
  // ctranslate2 needs libgomp1, which python:3.12-slim omits.
  assert.match(dockerfile, /apt-get install -y --no-install-recommends libgomp1/);
  assert.match(dockerfile, /rm -rf \/var\/lib\/apt\/lists\/\*/);
});

test("nginx exposes only the audio WebSocket at /transcribe/ws", () => {
  const nginx = readFileSync(join(dockerDir, "nginx", "default.conf.template"), "utf8");
  // Exact match: no other transcriber path (health, docs, admin) is reachable.
  assert.match(nginx, /location = \/transcribe\/ws \{/);
  assert.doesNotMatch(nginx, /location \/transcribe\//);
  assert.match(nginx, /rewrite \^ \/ws break;/);
  assert.match(nginx, /proxy_set_header Upgrade \$http_upgrade/);
  assert.match(nginx, /proxy_read_timeout 3600s/);
  assert.match(nginx, /http:\/\/transcriber:8787/);
  // Abuse limits: zone declarations in the http context and the directives in
  // the /transcribe/ location.
  assert.match(nginx, /limit_req_zone .* zone=transcribe_req:/);
  assert.match(nginx, /limit_conn_zone .* zone=transcribe_conn:/);
  assert.match(nginx, /limit_req zone=transcribe_req burst=40 nodelay;/);
  const connLimit = nginx.match(/limit_conn transcribe_conn (\d+);/);
  assert.ok(connLimit, "the transcription connection cap is set");
  const seats = readFileSync(join(repo, "packages", "convex", "convex", "lib", "calls.ts"), "utf8");
  const seatCap = seats.match(/export const MAX_CALL_SEATS = (\d+);/);
  assert.ok(seatCap, "MAX_CALL_SEATS is readable");
  // Per-peer `limit_conn` sees one address behind a proxy/NAT, so it must not
  // be lower than the hard seat ceiling or a full call would get a 503.
  assert.ok(
    Number(connLimit[1]) >= Number(seatCap[1]),
    `connection cap ${connLimit[1]} is below MAX_CALL_SEATS ${seatCap[1]}`,
  );
  assert.ok(Number(connLimit[1]) >= 50);
});

test("setup generates and forwards a transcriber token", () => {
  const entrypoint = readFileSync(join(dockerDir, "setup", "entrypoint.sh"), "utf8");
  assert.match(entrypoint, /TRANSCRIBER_TOKEN/);
  assert.match(entrypoint, /generated TRANSCRIBER_TOKEN/);
  const install = readFileSync(join(repo, "install.sh"), "utf8");
  assert.match(install, /TRANSCRIBER_TOKEN/);
});

test("nginx serves the guest call page unindexed, uncached and without a Referer", () => {
  const nginx = readFileSync(join(dockerDir, "nginx", "default.conf.template"), "utf8");
  const block = nginx.match(/location = \/call\/guest \{([\s\S]*?)\n  \}/);
  assert.ok(block, "the /call/guest location exists");
  const body = block[1];
  assert.match(body, /try_files \/index\.html =404;/);
  assert.match(body, /add_header X-Robots-Tag "noindex, nofollow, noarchive" always;/);
  assert.match(body, /add_header Referrer-Policy "no-referrer" always;/);
  assert.match(body, /add_header Cache-Control "no-store" always;/);
  // add_header in a location replaces inheritance, so the baseline is repeated.
  assert.match(body, /X-Content-Type-Options/);
  assert.match(body, /X-Frame-Options "DENY"/);
  assert.match(body, /Permissions-Policy "camera=\(self\), microphone=\(self\)/);
});
