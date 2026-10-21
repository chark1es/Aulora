import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const setupDir = fileURLToPath(new URL("..", import.meta.url));
const script = join(setupDir, "b64url.mjs");

function run(...args) {
  return execFileSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

test("encode prints unpadded base64url", () => {
  const value = '{"kty":"EC","crv":"P-256"}';
  const encoded = run("encode", value);
  assert.equal(encoded, Buffer.from(value, "utf8").toString("base64url"));
  assert.doesNotMatch(encoded, /[+/=]/);
});

test("encode round-trips a JWK", () => {
  const jwk = JSON.stringify({ kty: "EC", crv: "P-256", x: "a+b/c", kid: "abc" });
  const decoded = Buffer.from(run("encode", jwk), "base64url").toString("utf8");
  assert.equal(decoded, jwk);
});

test("random returns the requested number of bytes", () => {
  for (const bytes of [1, 16, 48]) {
    const value = run("random", String(bytes));
    assert.equal(Buffer.from(value, "base64url").length, bytes);
    assert.doesNotMatch(value, /[+/=]/);
  }
});

test("rejects an unknown mode", () => {
  assert.throws(() => run("sideways"), /unknown mode/);
});
