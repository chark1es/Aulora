import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The discovery document is consumed by older clients whose parser is stricter
// than the live public config. These key sets mirror the 1.4.0 client contract
// (`packages/core/src/well-known.ts` at that release): an unknown key is an
// INVALID_SHAPE failure, not an ignorable extra.

const SCRIPT = fileURLToPath(new URL("../well-known.mjs", import.meta.url));

const TOP_LEVEL_KEYS = new Set([
  "name",
  "version",
  "apiVersion",
  "convexUrl",
  "siteUrl",
  "iconSeed",
  "auth",
  "encryption",
]);
const AUTH_KEYS = new Set(["local", "providers"]);
const LOCAL_KEYS = new Set(["enabled", "signup"]);
const OAUTH_KEYS = new Set(["id", "type", "displayName"]);
const OIDC_KEYS = new Set([
  "id",
  "type",
  "displayName",
  "issuer",
  "discoveryUrl",
  "clientId",
  "scopes",
]);
const ENCRYPTION_KEYS = new Set(["mode", "algorithm", "keyVersion", "provider"]);

function assertOnlyKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    assert.equal(allowed.has(key), true, `${path}.${key} is not in the 1.4.0 contract`);
  }
}

function assertStrictDocument(document) {
  assertOnlyKeys(document, TOP_LEVEL_KEYS, "document");
  for (const key of ["name", "version", "convexUrl", "siteUrl", "iconSeed"]) {
    assert.equal(typeof document[key], "string", `${key} must be a string`);
    assert.ok(document[key].length > 0, `${key} must not be empty`);
  }
  assert.equal(typeof document.apiVersion, "number");

  assertOnlyKeys(document.auth, AUTH_KEYS, "auth");
  assertOnlyKeys(document.auth.local, LOCAL_KEYS, "auth.local");
  assert.equal(typeof document.auth.local.enabled, "boolean");
  assert.equal(typeof document.auth.local.signup, "boolean");
  for (const [index, provider] of document.auth.providers.entries()) {
    const path = `auth.providers[${index}]`;
    if (provider.type === "oauth") {
      assertOnlyKeys(provider, OAUTH_KEYS, path);
      assert.equal(typeof provider.id, "string");
      assert.equal(typeof provider.displayName, "string");
    } else {
      assert.equal(provider.type, "oidc", `${path}.type must be oauth or oidc`);
      assertOnlyKeys(provider, OIDC_KEYS, path);
      for (const key of ["id", "displayName", "issuer", "discoveryUrl", "clientId"]) {
        assert.equal(typeof provider[key], "string", `${path}.${key} must be a string`);
      }
      assert.ok(Array.isArray(provider.scopes), `${path}.scopes must be an array`);
    }
  }

  assertOnlyKeys(document.encryption, ENCRYPTION_KEYS, "encryption");
}

function render(publicConfig) {
  const result = spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      PUBLIC_CONFIG: JSON.stringify(publicConfig),
      NAME_VALUE: "Acme",
      SITE_URL_VALUE: "https://chat.example.com",
      CONVEX_URL_VALUE: "https://api.example.com",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("drops newer public-config fields such as minPasswordLength", () => {
  const document = render({
    name: "Acme",
    version: "1.5.0",
    apiVersion: 1,
    convexUrl: "https://api.example.com",
    siteUrl: "https://chat.example.com",
    iconSeed: "seed",
    auth: {
      local: { enabled: true, signup: false, minPasswordLength: 12 },
      providers: [],
    },
    encryption: {
      mode: "server",
      algorithm: "AES-256-GCM",
      keyVersion: "4",
      provider: "vault",
    },
  });

  assert.deepEqual(document.auth.local, { enabled: true, signup: false });
  assert.equal(JSON.stringify(document).includes("minPasswordLength"), false);
  assertStrictDocument(document);
});

test("allowlists provider and encryption fields to the previous release", () => {
  const document = render({
    name: "Acme",
    version: "1.5.0",
    apiVersion: 1,
    convexUrl: "https://api.example.com",
    siteUrl: "https://chat.example.com",
    iconSeed: "seed",
    auth: {
      local: { enabled: true, signup: true, minPasswordLength: 10 },
      providers: [
        {
          id: "github",
          type: "oauth",
          displayName: "GitHub",
          clientSecret: "must-not-leak",
          extra: "new-field",
        },
        {
          id: "corp",
          type: "oidc",
          displayName: "Corp",
          issuer: "https://idp.example.com",
          discoveryUrl: "https://idp.example.com/.well-known/openid-configuration",
          clientId: "client",
          scopes: ["openid", "email"],
          pkce: true,
        },
      ],
    },
    encryption: {
      mode: "server",
      algorithm: "AES-256-GCM",
      keyVersion: "4",
      provider: "vault",
      debug: true,
    },
  });

  assert.deepEqual(document.auth.providers[0], {
    id: "github",
    type: "oauth",
    displayName: "GitHub",
  });
  assert.deepEqual(document.auth.providers[1], {
    id: "corp",
    type: "oidc",
    displayName: "Corp",
    issuer: "https://idp.example.com",
    discoveryUrl: "https://idp.example.com/.well-known/openid-configuration",
    clientId: "client",
    scopes: ["openid", "email"],
  });
  assert.deepEqual(document.encryption, {
    mode: "server",
    algorithm: "AES-256-GCM",
    keyVersion: "4",
    provider: "vault",
  });
  assert.equal(JSON.stringify(document).includes("clientSecret"), false);
  assertStrictDocument(document);
});

test("falls back to a sign-in-only local auth block when the config omits auth", () => {
  const document = render({
    name: "Acme",
    version: "1.5.0",
    apiVersion: 1,
    convexUrl: "https://api.example.com",
    siteUrl: "https://chat.example.com",
    iconSeed: "seed",
  });

  assert.deepEqual(document.auth, {
    local: { enabled: false, signup: false },
    providers: [],
  });
  assertStrictDocument(document);
});
