// Guards the generated environment reference against drift: a key added to the
// server catalog (or the extras list) must appear on the generated page. The
// expected keys are read straight from the TypeScript sources with a simple
// scan, independent of the structured parser the generator uses.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readEnvCatalog } from "./env-catalog.mjs";
import { buildGroups, renderEnvReference } from "./env-reference.mjs";
import { EXTRA_ENV_VARS, EXTRA_GROUPS } from "./env-reference-extras.mjs";
import { buildSearchIndex, plainText } from "./search-index.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const libDir = join(root, "packages", "convex", "convex", "lib");
const CATALOG_FILES = ["envCatalogAuth.ts", "envCatalogInstance.ts", "envCatalogDeployment.ts"];

function sourceKeys() {
  const keys = new Set();
  for (const file of CATALOG_FILES) {
    const source = readFileSync(join(libDir, file), "utf8");
    for (const match of source.matchAll(/^\s*key: "([A-Z0-9_]+)",?$/gm)) keys.add(match[1]);
  }
  return keys;
}

const extras = { groups: EXTRA_GROUPS, variables: EXTRA_ENV_VARS };
const renderIcon = () => "";

test("reads every catalog key and keeps one entry per key", () => {
  const catalog = readEnvCatalog(root);
  const keys = sourceKeys();
  const parsed = catalog.variables.map((variable) => variable.key);
  assert.equal(parsed.length, new Set(parsed).size, "duplicate catalog key");
  assert.deepEqual([...parsed].sort(), [...keys].sort());
  assert.deepEqual(catalog.required, [
    "OIDC_ISSUER",
    "OIDC_DISCOVERY_URL",
    "OIDC_CLIENT_ID",
    "OIDC_CLIENT_SECRET",
  ]);
});

test("parses multi-line descriptions and the optional fields", () => {
  const catalog = readEnvCatalog(root);
  const byKey = new Map(catalog.variables.map((variable) => [variable.key, variable]));
  assert.match(byKey.get("OIDC_DISCOVERY_URL").description, /openid-configuration\.$/);
  assert.deepEqual(byKey.get("AULORA_EMAIL_PROVIDER").enumValues, ["none", "resend", "smtp"]);
  assert.equal(byKey.get("AUTH_MIN_PASSWORD_LENGTH").min, 1);
  assert.equal(byKey.get("AUTH_MIN_PASSWORD_LENGTH").max, 128);
  assert.equal(byKey.get("RESEND_API_KEY").secret, true);
  assert.equal(byKey.get("GITHUB_CLIENT_ID").overridable, true);
  assert.equal(byKey.get("AULORA_EKM_PROVIDER").type, "enum");
});

test("includes the local-auth switch that gates email/password sign-in", () => {
  const catalog = readEnvCatalog(root);
  assert.ok(catalog.variables.some((variable) => variable.key === "AUTH_LOCAL_ENABLED"));
});

test("generated page lists every catalog and extra variable", () => {
  const catalog = readEnvCatalog(root);
  const { html, title } = renderEnvReference(catalog, extras, renderIcon);
  assert.equal(title, "Environment variables");
  for (const key of sourceKeys())
    assert.ok(html.includes(`>${key}</code>`), `page is missing ${key}`);
  for (const variable of EXTRA_ENV_VARS) {
    assert.ok(html.includes(`>${variable.key}</code>`), `page is missing ${variable.key}`);
  }
});

test("variable rows carry no duplicated data-search payload", () => {
  const catalog = readEnvCatalog(root);
  const { html } = renderEnvReference(catalog, extras, renderIcon);
  assert.ok(html.includes("data-env-var"), "rows are still marked for the filter");
  assert.ok(!html.includes("data-search="), "the page must not duplicate every field");
});

test("generated page renders one section per non-empty group", () => {
  const catalog = readEnvCatalog(root);
  const groups = buildGroups(catalog, extras);
  assert.ok(groups.length >= catalog.groups.length, "a catalog group vanished");
  for (const { group, variables } of groups) {
    assert.ok(variables.length > 0);
    assert.ok(group.id.length > 0 && group.label.length > 0);
  }
});

test("search index exposes headings, anchors and plain text", () => {
  const index = buildSearchIndex([
    {
      title: "Sample",
      url: "docs/sample",
      html: '<p>Intro text.</p><h2 id="one">First <em>heading</em></h2><p>Body <code>code</code>.</p>',
    },
  ]);
  assert.equal(index.entries.length, 2);
  assert.deepEqual(
    index.entries.map((entry) => [entry.url, entry.id, entry.heading]),
    [
      ["docs/sample", "", "Sample"],
      ["docs/sample", "one", "First heading"],
    ],
  );
  assert.equal(index.entries[1].text, "Body code.");
});

test("plainText drops tags and decodes entities", () => {
  assert.equal(plainText("<p>a &amp; b <strong>c</strong></p>"), "a & b c");
});
