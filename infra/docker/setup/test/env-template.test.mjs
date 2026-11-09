import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Guards the shipped configuration boundary: the default `.env.example` and
// compose files must not set an overridable variable to a value (or to an empty
// placeholder with a default), so the owner's Instance admin override is never
// shadowed on a fresh install. Environment values remain supported.

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..", "..");
const docker = join(repo, "infra", "docker");
const catalogDir = join(repo, "packages", "convex", "convex", "lib");
const CATALOG_FILES = ["envCatalogAuth.ts", "envCatalogInstance.ts", "envCatalogDeployment.ts"];

function catalogEntries() {
  const entries = new Map();
  for (const file of CATALOG_FILES) {
    const source = readFileSync(join(catalogDir, file), "utf8");
    const pattern = /key: "([A-Z0-9_]+)",\n {4}group: "[^"]+",\n {4}tier: "([^"]+)"/g;
    for (const match of source.matchAll(pattern)) {
      entries.set(match[1], match[2]);
    }
  }
  return entries;
}

const entries = catalogEntries();
const overridable = [...entries.entries()]
  .filter(([, tier]) => tier === "overridable")
  .map(([key]) => key)
  .sort();

test("catalog classifies every key", () => {
  assert.ok(entries.size > 60);
  assert.ok(overridable.length >= 20);
});

test("the default .env template never sets an overridable key", () => {
  const env = readFileSync(join(docker, ".env.example"), "utf8");
  const active = new Set([...env.matchAll(/^([A-Z0-9_]+)=/gm)].map((match) => match[1]));
  for (const key of overridable) {
    assert.equal(active.has(key), false, `${key} must stay commented or absent in .env.example`);
  }
});

test("plain compose does not pass overridable keys through a service environment", () => {
  const compose = readFileSync(join(docker, "docker-compose.yml"), "utf8");
  for (const key of overridable) {
    assert.equal(
      new RegExp(`^\\s+${key}:`, "m").test(compose),
      false,
      `${key} must come from .env/env_file, not a compose environment default`,
    );
  }
});

test("Coolify compose only uses an empty default for overridable keys", () => {
  const compose = readFileSync(join(docker, "docker-compose.coolify.yml"), "utf8");
  for (const key of overridable) {
    const pattern = new RegExp(`\\$\\{${key}:-([^}]*)\\}`, "g");
    for (const match of compose.matchAll(pattern)) {
      assert.equal(
        match[1],
        "",
        `${key} must not have a non-empty compose default that shadows an override`,
      );
    }
    assert.equal(
      new RegExp(`^\\s+${key}: \\$\\{${key}\\}$`, "m").test(compose),
      false,
      `${key} must be optional, not a bare required interpolation`,
    );
  }
});

test("setup forwards deployment-only env values without inventing defaults", () => {
  const entrypoint = readFileSync(join(docker, "setup", "entrypoint.sh"), "utf8");
  for (const key of [
    "AUTH_RATE_LIMIT_MAX",
    "UPLOAD_MAX_BYTES",
    "SEND_RATE_LIMIT",
    "INVITE_RATE_LIMIT",
    "AUDIT_LOG_RETENTION_DAYS",
    "PUSH_RELAY_URL",
    "PUSH_RELAY_TOKEN",
    "AULORA_MIN_CLIENT_VERSION",
  ]) {
    assert.ok(entrypoint.includes(key), `setup does not forward ${key}`);
  }
  // Empty values are skipped by set_env_if_present, so an unset optional value
  // never becomes an empty deployment env var.
  assert.match(entrypoint, /\[ -n "\$value" \] \|\| return 0/);
});
