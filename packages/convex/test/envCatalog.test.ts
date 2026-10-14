import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import {
  ENV_VAR_CATALOG,
  ENV_VAR_GROUPS,
  findEnvVarDefinition,
  isOverridableEnvVar,
  isSecretEnvVar,
  OIDC_REQUIRED_ENV_KEYS,
} from "../convex/lib/envCatalog";
import {
  buildEffectiveEnv,
  decryptSealedOverrides,
  envLookup,
  envOverrideContext,
  envVarSource,
  isEnvValueSet,
  uiEnvOverridesEnabled,
  validateEnvOverrideValue,
} from "../convex/lib/envOverrides";
import { openString, sealString } from "../convex/lib/sse";

const READ_ONLY_KEYS = [
  "BETTER_AUTH_SECRET",
  "SETUP_TOKEN",
  "INSTANCE_SECRET",
  "SITE_URL",
  "CONVEX_SITE_URL",
  "CONVEX_CLOUD_URL",
  "TRUSTED_ORIGINS",
  "BACKUP_TOKEN",
  "PUSH_RELAY_TOKEN",
  "AULORA_ENCRYPTION_KEY",
  "AULORA_KEK_WRAPPED",
  "VAULT_TOKEN",
  "AULORA_ALLOW_UI_ENV_OVERRIDES",
];

describe("environment catalog", () => {
  it("lists every key exactly once", () => {
    const keys = ENV_VAR_CATALOG.map((definition) => definition.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThan(60);
  });

  it("lists bootstrap and lock-out variables as read-only", () => {
    for (const key of READ_ONLY_KEYS) {
      expect(findEnvVarDefinition(key)?.overridable, key).toBe(false);
      expect(isOverridableEnvVar(key), key).toBe(false);
    }
  });

  it("lists the required override set as overridable", () => {
    const overridable = [
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "MICROSOFT_CLIENT_ID",
      "MICROSOFT_CLIENT_SECRET",
      "APPLE_CLIENT_ID",
      "APPLE_CLIENT_SECRET",
      "OIDC_DISPLAY_NAME",
      "OIDC_ISSUER",
      "OIDC_DISCOVERY_URL",
      "OIDC_CLIENT_ID",
      "OIDC_CLIENT_SECRET",
      "OIDC_SCOPES",
      "OIDC_GROUP_CLAIM",
      "OIDC_GROUP_ROLE_MAP",
      "AUTH_LOCAL_ENABLED",
      "AUTH_LOCAL_SIGNUP",
      "AUTH_MIN_PASSWORD_LENGTH",
      "AUTH_RATE_LIMIT_MAX",
      "AULORA_ICE_SERVERS",
    ];
    for (const key of overridable) {
      expect(isOverridableEnvVar(key), key).toBe(true);
    }
    for (const key of OIDC_REQUIRED_ENV_KEYS) {
      expect(isOverridableEnvVar(key), key).toBe(true);
    }
  });
});

describe("environment catalog lookups", () => {
  it("marks provider secrets as secret and identifiers as public", () => {
    expect(isSecretEnvVar("GITHUB_CLIENT_SECRET")).toBe(true);
    expect(isSecretEnvVar("OIDC_CLIENT_SECRET")).toBe(true);
    expect(isSecretEnvVar("GITHUB_CLIENT_ID")).toBe(false);
    expect(isSecretEnvVar("OIDC_ISSUER")).toBe(false);
  });

  it("uses only declared groups", () => {
    const groupIds = new Set(ENV_VAR_GROUPS.map((group) => group.id));
    for (const definition of ENV_VAR_CATALOG) {
      expect(groupIds.has(definition.group), definition.key).toBe(true);
    }
  });

  it("returns undefined for unknown keys", () => {
    expect(findEnvVarDefinition("NOT_A_REAL_VAR")).toBeUndefined();
  });
});

describe("validateEnvOverrideValue deny rules", () => {
  it("rejects unknown and deployment-managed keys", () => {
    expect(() => validateEnvOverrideValue("NOT_A_REAL_VAR", "x")).toThrow(ConvexError);
    expect(() => validateEnvOverrideValue("NOT_A_REAL_VAR", "x")).toThrow(
      "Unknown environment variable",
    );
    expect(() => validateEnvOverrideValue("BETTER_AUTH_SECRET", "x")).toThrow(
      "managed by the deployment",
    );
  });
});

describe("validateEnvOverrideValue", () => {
  it("accepts https URLs and only http on localhost", () => {
    expect(validateEnvOverrideValue("OIDC_ISSUER", "https://idp.example.com")).toBe(
      "https://idp.example.com",
    );
    expect(validateEnvOverrideValue("OIDC_ISSUER", "http://localhost:8080")).toBe(
      "http://localhost:8080",
    );
    expect(() => validateEnvOverrideValue("OIDC_ISSUER", "http://idp.example.com")).toThrow(
      "https URL",
    );
    expect(() => validateEnvOverrideValue("OIDC_ISSUER", "ftp://idp.example.com")).toThrow(
      "https URL",
    );
  });

  it("enforces number ranges", () => {
    expect(validateEnvOverrideValue("AUTH_MIN_PASSWORD_LENGTH", "12")).toBe("12");
    expect(() => validateEnvOverrideValue("AUTH_MIN_PASSWORD_LENGTH", "0")).toThrow("at least 1");
    expect(() => validateEnvOverrideValue("AUTH_MIN_PASSWORD_LENGTH", "129")).toThrow(
      "at most 128",
    );
    expect(() => validateEnvOverrideValue("AUTH_MIN_PASSWORD_LENGTH", "many")).toThrow(
      "whole number",
    );
  });

  it("normalizes booleans and rejects other words", () => {
    expect(validateEnvOverrideValue("AUTH_LOCAL_ENABLED", "TRUE")).toBe("true");
    expect(validateEnvOverrideValue("AUTH_LOCAL_SIGNUP", "false")).toBe("false");
    expect(() => validateEnvOverrideValue("AUTH_LOCAL_ENABLED", "yes")).toThrow(
      '"true" or "false"',
    );
  });

  it("parses lists into space-separated values", () => {
    expect(validateEnvOverrideValue("OIDC_SCOPES", "openid, profile  email")).toBe(
      "openid profile email",
    );
    expect(() => validateEnvOverrideValue("OIDC_SCOPES", " , ")).toThrow("at least one value");
  });
});

describe("validateEnvOverrideValue JSON and bounds", () => {
  it("validates JSON formats", () => {
    expect(validateEnvOverrideValue("AULORA_ICE_SERVERS", '[{"urls":["stun:x:3478"]}]')).toContain(
      "stun",
    );
    expect(() => validateEnvOverrideValue("AULORA_ICE_SERVERS", "{}")).toThrow("JSON array");
    expect(() => validateEnvOverrideValue("AULORA_ICE_SERVERS", "not json")).toThrow("valid JSON");
    expect(validateEnvOverrideValue("OIDC_GROUP_ROLE_MAP", '{"admins":"Admin"}')).toBe(
      '{"admins":"Admin"}',
    );
    expect(() => validateEnvOverrideValue("OIDC_GROUP_ROLE_MAP", "[1]")).toThrow("JSON object");
    expect(() => validateEnvOverrideValue("OIDC_GROUP_ROLE_MAP", '{"admins":1}')).toThrow(
      "role name",
    );
  });

  it("rejects link-local URLs", () => {
    expect(() =>
      validateEnvOverrideValue("OIDC_DISCOVERY_URL", "https://169.254.169.254/latest"),
    ).toThrow("Link-local");
  });

  it("rejects empty and oversized values", () => {
    expect(() => validateEnvOverrideValue("OIDC_CLIENT_ID", "   ")).toThrow("Enter a value");
    expect(() => validateEnvOverrideValue("OIDC_CLIENT_ID", "x".repeat(9000))).toThrow("at most");
  });
});

describe("effective environment", () => {
  it("lets an override win over the deployment value", () => {
    const merged = buildEffectiveEnv(
      { GITHUB_CLIENT_ID: "env-id", OIDC_SCOPES: "openid" },
      new Map([["GITHUB_CLIENT_ID", "ui-id"]]),
    );
    expect(merged.GITHUB_CLIENT_ID).toBe("ui-id");
    expect(merged.OIDC_SCOPES).toBe("openid");
  });

  it("never pairs a deployment secret with an owner-chosen OIDC endpoint", () => {
    const merged = buildEffectiveEnv(
      {
        OIDC_ISSUER: "https://idp.example.com",
        OIDC_DISCOVERY_URL: "https://idp.example.com/.well-known/openid-configuration",
        OIDC_CLIENT_ID: "env-id",
        OIDC_CLIENT_SECRET: "env-secret",
        OIDC_SCOPES: "openid",
      },
      new Map([
        ["OIDC_DISCOVERY_URL", "https://attacker.example.com/.well-known/openid-configuration"],
      ]),
    );
    expect(merged.OIDC_DISCOVERY_URL).toContain("attacker.example.com");
    expect(merged.OIDC_CLIENT_SECRET).toBeUndefined();
    expect(merged.OIDC_CLIENT_ID).toBeUndefined();
    expect(merged.OIDC_ISSUER).toBeUndefined();
    // Settings outside the credential group still inherit the deployment value.
    expect(merged.OIDC_SCOPES).toBe("openid");
  });

  it("keeps deployment values when a full credential group is overridden together", () => {
    const merged = buildEffectiveEnv(
      { GITHUB_CLIENT_ID: "env-id", GITHUB_CLIENT_SECRET: "env-secret" },
      new Map([
        ["GITHUB_CLIENT_ID", "ui-id"],
        ["GITHUB_CLIENT_SECRET", "ui-secret"],
      ]),
    );
    expect(merged.GITHUB_CLIENT_ID).toBe("ui-id");
    expect(merged.GITHUB_CLIENT_SECRET).toBe("ui-secret");
  });

  it("ignores overrides for keys outside the allowlist", () => {
    const merged = buildEffectiveEnv(
      { BETTER_AUTH_SECRET: "env-secret" },
      new Map([
        ["BETTER_AUTH_SECRET", "evil"],
        ["SITE_URL", "https://evil.example.com"],
      ]),
    );
    expect(merged.BETTER_AUTH_SECRET).toBe("env-secret");
    expect(merged.SITE_URL).toBeUndefined();
  });

  it("reads deployment values from a non-enumerable env, like Convex's process.env", () => {
    // Convex's default runtime (udf-runtime/src/00_misc.ts) implements
    // `process.env` as a Proxy over `{}` with only a `get` trap, so
    // Object.entries/Object.keys/spread see nothing while reads still work.
    const runtimeEnv = new Proxy({} as Record<string, string>, {
      get: (_target, prop) => (prop === "SITE_URL" ? "https://chat.acme.com" : undefined),
    });
    expect(Object.keys(runtimeEnv)).toHaveLength(0);

    const merged = buildEffectiveEnv(runtimeEnv, new Map([["GITHUB_CLIENT_ID", "ui-id"]]));
    expect(merged.SITE_URL).toBe("https://chat.acme.com");
    expect(merged.GITHUB_CLIENT_ID).toBe("ui-id");
  });

  it("reflects applied overrides and hides removed group members when enumerated", () => {
    const merged = buildEffectiveEnv(
      { OIDC_ISSUER: "https://idp.example.com", OIDC_CLIENT_ID: "env-id", OIDC_SCOPES: "openid" },
      new Map([["OIDC_CLIENT_ID", "ui-id"]]),
    );
    const keys = Object.keys(merged);
    expect(keys).toContain("OIDC_CLIENT_ID");
    expect(keys).toContain("OIDC_SCOPES");
    expect(keys).not.toContain("OIDC_ISSUER");
    expect(merged.OIDC_CLIENT_ID).toBe("ui-id");
    expect("OIDC_SCOPES" in merged).toBe(true);
    expect("OIDC_ISSUER" in merged).toBe(false);
  });

  it("reports the source of each variable without exposing values", () => {
    const lookup = envLookup({ GITHUB_CLIENT_ID: "env-id", OIDC_SCOPES: "   " });
    expect(isEnvValueSet(lookup, "GITHUB_CLIENT_ID")).toBe(true);
    expect(isEnvValueSet(lookup, "OIDC_SCOPES")).toBe(false);
    expect(envVarSource("GITHUB_CLIENT_ID", new Set(), lookup)).toBe("environment");
    expect(envVarSource("GITHUB_CLIENT_ID", new Set(["GITHUB_CLIENT_ID"]), lookup)).toBe("ui");
    expect(envVarSource("OIDC_SCOPES", new Set(), lookup)).toBe("unset");
  });

  it("resolves explicitly named keys on a non-enumerable env", () => {
    const runtimeEnv = new Proxy({} as Record<string, string>, {
      get: (_target, prop) => (prop === "SITE_URL" ? "https://chat.acme.com" : undefined),
    });
    const lookup = envLookup(runtimeEnv, ["SITE_URL", "MISSING"]);
    expect(isEnvValueSet(lookup, "SITE_URL")).toBe(true);
    expect(isEnvValueSet(lookup, "MISSING")).toBe(false);
    expect(envVarSource("SITE_URL", new Set(), lookup)).toBe("environment");
  });
});

describe("kill switch", () => {
  it("disables only on the exact value false", () => {
    expect(uiEnvOverridesEnabled({})).toBe(true);
    expect(uiEnvOverridesEnabled({ AULORA_ALLOW_UI_ENV_OVERRIDES: "0" })).toBe(true);
    expect(uiEnvOverridesEnabled({ AULORA_ALLOW_UI_ENV_OVERRIDES: "no" })).toBe(true);
    expect(uiEnvOverridesEnabled({ AULORA_ALLOW_UI_ENV_OVERRIDES: "false" })).toBe(false);
  });
});

describe("sealed override values", () => {
  it("round-trips a value and binds it to its key", async () => {
    const sealed = await sealString(envOverrideContext("OIDC_CLIENT_SECRET"), "s3cret-value");
    expect(sealed.startsWith("aulora-sse-")).toBe(true);
    expect(sealed).not.toContain("s3cret-value");
    const values = await decryptSealedOverrides([
      { key: "OIDC_CLIENT_SECRET", valueCiphertext: sealed },
    ]);
    expect(values.get("OIDC_CLIENT_SECRET")).toBe("s3cret-value");
    // The same envelope cannot be replayed under another key (AAD includes it).
    const moved = await decryptSealedOverrides([
      { key: "OIDC_CLIENT_ID", valueCiphertext: sealed },
    ]);
    expect(moved.size).toBe(0);
    await expect(openString(envOverrideContext("GITHUB_CLIENT_ID"), sealed)).rejects.toThrow();
  });

  it("skips rows for keys outside the allowlist", async () => {
    const sealed = await sealString(envOverrideContext("BETTER_AUTH_SECRET"), "boot-secret");
    const values = await decryptSealedOverrides([
      { key: "BETTER_AUTH_SECRET", valueCiphertext: sealed },
    ]);
    expect(values.size).toBe(0);
  });
});
