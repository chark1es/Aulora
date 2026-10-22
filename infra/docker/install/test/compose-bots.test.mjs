import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The bot runner starts with the stack. Its hardening (read-only root, dropped
// capabilities, dedicated network, no env_file and no host mounts) is a security
// boundary, so guard it against a future profile or mount being added back.

const dockerDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

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
  test(`bot-runner starts by default in ${file}`, () => {
    const block = serviceBlock(file, "bot-runner");
    assert.doesNotMatch(block, /^\s+profiles:/m);
    assert.match(block, /^ {6}BOT_RUNNER_ENABLED: \$\{BOT_RUNNER_ENABLED:-true\}$/m);
    assert.match(block, /^ {4}restart: unless-stopped$/m);
    assert.match(block, /^ {4}read_only: true$/m);
    assert.match(block, /^ {6}- ALL$/m);
    assert.match(block, /^ {6}- SETUID$/m);
    assert.match(block, /^ {6}- /m);
    assert.match(block, /^ {4}tmpfs:/m);
    assert.match(block, /^ {6}- bots$/m);
    assert.doesNotMatch(block, /^\s+env_file:/m);
    assert.doesNotMatch(block, /^\s+volumes:/m);
    assert.doesNotMatch(block, /\/host/);
    assert.match(block, /convex-backend:\n {8}condition: service_healthy/);
    assert.match(block, /setup:\n {8}condition: service_completed_successfully/);
  });
}
