import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SETUP_DIR = fileURLToPath(new URL("..", import.meta.url));
const DOCKER_DIR = fileURLToPath(new URL("../..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

function runTokenScript(mode, input) {
  return spawnSync(process.execPath, [join(SETUP_DIR, "setup-token.mjs"), mode], {
    encoding: "utf8",
    input,
  });
}

test("first-run setup does not put owner credentials in the shipped env template", () => {
  const template = readFileSync(join(DOCKER_DIR, ".env.example"), "utf8");
  for (const key of ["OWNER_EMAIL", "OWNER_PASSWORD", "OWNER_NAME"]) {
    const active = template.split("\n").find((line) => line.startsWith(`${key}=`));
    assert.equal(active, undefined, `${key} must stay commented out by default`);
  }
});

test("the setup entrypoint prints a token from Convex instead of generating one into env", () => {
  const entrypoint = readFileSync(join(SETUP_DIR, "entrypoint.sh"), "utf8");
  assert.doesNotMatch(entrypoint, /SETUP_TOKEN_GENERATED/);
  assert.match(entrypoint, /setupState:issueSetupToken/);
  assert.match(entrypoint, /setup-token\.mjs" token/);
  assert.match(entrypoint, /setup token \(shown once/);
  // The plaintext token must never be written back to .env.
  assert.doesNotMatch(entrypoint, /env_set SETUP_TOKEN/);
});

test("the setup entrypoint keeps the legacy OWNER_* seeding path", () => {
  const entrypoint = readFileSync(join(SETUP_DIR, "entrypoint.sh"), "utf8");
  assert.match(entrypoint, /LEGACY_OWNER_SEED=1/);
  assert.match(entrypoint, /legacy OWNER_\* credentials configured/);
  assert.match(entrypoint, /OWNER_EMAIL_VALUE|OWNER_PASSWORD_VALUE/);
});

test("compose does not default owner credentials", () => {
  const compose = readFileSync(join(DOCKER_DIR, "docker-compose.yml"), "utf8");
  assert.doesNotMatch(compose, /OWNER_PASSWORD=change-me/);
  assert.doesNotMatch(compose, /owner@example\.com/);
});

test("the setup token helper reads the issued token and expiry", () => {
  const payload = JSON.stringify({ token: "abc123", expiresAt: 1_700_000_000_000 });
  const token = runTokenScript("token", payload);
  assert.equal(token.status, 0, token.stderr);
  assert.equal(token.stdout, "abc123");
  const expires = runTokenScript("expires", payload);
  assert.equal(expires.stdout, new Date(1_700_000_000_000).toISOString());
  const status = runTokenScript("status", payload);
  assert.equal(status.stdout, "issued");
});

test("the setup token helper reports an existing but unprintable token", () => {
  const payload = JSON.stringify({ token: null, expiresAt: 1_700_000_000_000 });
  const result = runTokenScript("status", payload);
  assert.equal(result.stdout, "existing");
  assert.equal(runTokenScript("token", payload).stdout, "");
});

test("the setup token helper finds the last JSON line among CLI output", () => {
  const payload = [
    "warning: something noisy",
    '{"token":"first","expiresAt":1}',
    "another diagnostic",
    '{"token":"abc123","expiresAt":1700000000000}',
    "",
  ].join("\n");
  const token = runTokenScript("token", payload);
  assert.equal(token.status, 0, token.stderr);
  assert.equal(token.stdout, "abc123");
  assert.equal(runTokenScript("status", payload).stdout, "issued");
});

test("the setup token helper parses the CLI's multi-line pretty-printed result", () => {
  // The pinned Convex CLI prints JSON.stringify(result, null, 2) when stdout is
  // captured, so a whole-line JSON parser cannot read a fresh install's token.
  const payload = [
    "warning: some diagnostic line",
    "Running function setupState:issueSetupToken",
    "{",
    '  "token": "abc123",',
    '  "expiresAt": 1700000000000',
    "}",
    "done",
    "",
  ].join("\n");
  const token = runTokenScript("token", payload);
  assert.equal(token.status, 0, token.stderr);
  assert.equal(token.stdout, "abc123");
  assert.equal(runTokenScript("status", payload).stdout, "issued");
  assert.equal(
    runTokenScript("expires", payload).stdout,
    new Date(1_700_000_000_000).toISOString(),
  );
});

test("the setup token helper skips braces inside strings and noisy prefix/suffix lines", () => {
  const payload = [
    '{"warning":"not the result"}',
    "provider diagnostic {still not json}",
    'console.log("a \\"}\\" in a message")',
    "{",
    '  "token": "tok{en}with\\"braces",',
    '  "expiresAt": 1700000000000,',
    '  "nested": { "note": "} not the end" }',
    "}",
    "cleanup complete",
    "",
  ].join("\n");
  const token = runTokenScript("token", payload);
  assert.equal(token.status, 0, token.stderr);
  assert.equal(token.stdout, 'tok{en}with"braces');
  assert.equal(runTokenScript("status", payload).stdout, "issued");
});

test("the setup token helper ignores non-object trailing lines", () => {
  const payload = `${JSON.stringify({ token: "abc123", expiresAt: 1 })}\n42\n`;
  assert.equal(runTokenScript("token", payload).stdout, "abc123");
});

test("the setup token helper rejects malformed input", () => {
  const result = runTokenScript("token", "not-json");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /could not parse/);
});

test("setup rotates a token only when asked, not on every deploy", () => {
  const entrypoint = readFileSync(join(SETUP_DIR, "entrypoint.sh"), "utf8");
  assert.match(entrypoint, /issueSetupToken '\{\}'/);
  assert.match(entrypoint, /SETUP_TOKEN_ROTATE/);
  // rotate:true must not be unconditional: it appears behind the explicit
  // force branch of issue_setup_token.
  const rotateCalls = entrypoint.match(/issueSetupToken '\{"rotate":true\}'/g) ?? [];
  assert.equal(rotateCalls.length, 1);
});

test("the docker README describes the in-app first-run claim", () => {
  const readme = readFileSync(join(DOCKER_DIR, "README.md"), "utf8");
  assert.match(readme, /setup token/i);
  assert.match(readme, /Set up your instance|register the owner/i);
});

test("release docs mention the additive owner list", () => {
  const releases = readFileSync(join(REPO_ROOT, "docs", "releases.md"), "utf8");
  assert.match(releases, /ownerIds|multiple owners/i);
});
