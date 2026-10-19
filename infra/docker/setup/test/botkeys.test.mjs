import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { decodeBase64Url, generateJwks } from "../botkeys.mjs";

const SETUP_DIR = fileURLToPath(new URL("..", import.meta.url));
const BOTKEYS = join(SETUP_DIR, "botkeys.mjs");

function hasBash() {
  return spawnSync("bash", ["--version"], { stdio: "ignore" }).status === 0;
}

const bashSkip =
  process.platform === "win32"
    ? "run the setup shell tests on Linux or macOS"
    : hasBash()
      ? false
      : "bash is not available";

test("generateJwks makes a matching ES256 P-256 pair", () => {
  const { privateJwk, publicJwk } = generateJwks();
  const priv = JSON.parse(privateJwk);
  const pub = JSON.parse(publicJwk);
  assert.equal(priv.kty, "EC");
  assert.equal(priv.crv, "P-256");
  assert.equal(pub.kty, "EC");
  assert.equal(pub.crv, "P-256");
  assert.ok(priv.d, "private JWK carries the private scalar");
  assert.equal(pub.d, undefined, "public JWK must not carry the private scalar");
  assert.equal(priv.x, pub.x);
  assert.equal(priv.y, pub.y);
  assert.ok(priv.kid, "both JWKs carry a kid");
  assert.equal(priv.kid, pub.kid);
});

test("the botkeys CLI prints the private then the public JWK", () => {
  const result = spawnSync("node", [BOTKEYS], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 2);
  const [priv, pub] = lines.map((line) => JSON.parse(line));
  assert.ok(priv.d);
  assert.equal(pub.d, undefined);
  assert.equal(priv.kid, pub.kid);
});

test("botkeys decode inverts the base64url encoding of a JSON JWK", () => {
  const jwk = '{"kty":"EC","crv":"P-256","kid":"abc","d":"x-y_z"}';
  const encoded = Buffer.from(jwk, "utf8").toString("base64url");
  const result = spawnSync("node", [BOTKEYS, "decode", encoded], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), jwk);
  assert.equal(decodeBase64Url(encoded), jwk);
});

test("botkeys decode rejects a missing value", () => {
  const result = spawnSync("node", [BOTKEYS, "decode"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /decode requires a base64url value/);
});

// The setup entrypoint stores the JWKs base64url-encoded because a JWK contains
// quotes and braces. This exercises the exact env_set/env_get helpers the
// entrypoint sources, including a raw JSON value, to prove the round trip.
const ENV_ROUNDTRIP = `
set -euo pipefail
source "$SETUP_DIR/envfile.sh"
file="$1"
printf 'A=1\\nB=2\\n' > "$file"
env_set RAW '{"kty":"EC","kid":"abc","d":"x-y_z"}' "$file"
env_set B64 'eyJrdHkiOiJFQyJ9' "$file"
env_set NEW 'fresh' "$file"
test "$(env_get RAW "$file")" = '{"kty":"EC","kid":"abc","d":"x-y_z"}'
test "$(env_get B64 "$file")" = 'eyJrdHkiOiJFQyJ9'
test "$(env_get A "$file")" = '1'
test "$(env_get NEW "$file")" = 'fresh'
env_set B64 'updated-value' "$file"
test "$(env_get B64 "$file")" = 'updated-value'
env_set A 'one' "$file"
test "$(env_get A "$file")" = 'one'
printf 'ok\\n'
`;

test("env_set/env_get round-trip JSON-with-quotes and base64url values", { skip: bashSkip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "aulora-envfile-"));
  try {
    const file = join(dir, ".env");
    const result = spawnSync("bash", ["-c", ENV_ROUNDTRIP, "roundtrip", file], {
      encoding: "utf8",
      env: { ...process.env, SETUP_DIR },
      input: "",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ok/);
    const written = readFileSync(file, "utf8");
    assert.match(written, /B64=updated-value/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("entrypoint generates bot secrets before deploying", () => {
  const entrypoint = readFileSync(join(SETUP_DIR, "entrypoint.sh"), "utf8");
  assert.match(entrypoint, /source "\$SETUP_DIR\/envfile\.sh"/);
  assert.match(entrypoint, /node "\$SETUP_DIR\/botkeys\.mjs"/);
  assert.match(entrypoint, /set_env_if_present BOT_JWT_PUBLIC_JWK/);
  assert.match(entrypoint, /set_env_if_present BOT_JWT_PRIVATE_JWK ".*" 1/);
  assert.match(entrypoint, /set_env_if_present BOT_RUNNER_TOKEN ".*" 1/);
  assert.match(entrypoint, /env_set BOT_RUNNER_TOKEN /);
  // The public key must be on the deployment before `convex deploy` runs.
  const publicKeyAt = entrypoint.indexOf("set_env_if_present BOT_JWT_PUBLIC_JWK");
  const deployAt = entrypoint.indexOf("convex deploy --yes");
  assert.ok(publicKeyAt >= 0 && deployAt >= 0 && publicKeyAt < deployAt);
});

test("entrypoint does not print the runner token or JWKs", () => {
  const entrypoint = readFileSync(join(SETUP_DIR, "entrypoint.sh"), "utf8");
  assert.doesNotMatch(entrypoint, /log .*BOT_RUNNER_TOKEN_VALUE/);
  assert.doesNotMatch(entrypoint, /log .*BOT_JWT_PRIVATE_JWK_VALUE/);
  assert.doesNotMatch(entrypoint, /echo .*BOT_JWT_PRIVATE_JWK_VALUE/);
});
