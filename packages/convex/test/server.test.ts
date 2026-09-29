import { containsSecretField } from "@aulora/core";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import { modules } from "./setup";

const ENV_KEYS = [
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "APPLE_CLIENT_ID",
  "APPLE_CLIENT_SECRET",
  "OIDC_ISSUER",
  "OIDC_DISCOVERY_URL",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_DISPLAY_NAME",
  "OIDC_SCOPES",
  "AUTH_LOCAL_ENABLED",
  "AULORA_EKM_PROVIDER",
  "AULORA_ENCRYPTION_KEY_VERSION",
] as const;

function clearEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

afterEach(clearEnv);

describe("server.publicConfig", () => {
  it("returns local auth and no providers by default", async () => {
    clearEnv();
    const t = convexTest(schema, modules);
    const config = await t.query(api.server.publicConfig);

    expect(config.name).toBe("Aulora");
    expect(typeof config.version).toBe("string");
    expect(config.apiVersion).toBe(1);
    expect(config.auth.local).toEqual({ enabled: true, signup: true });
    expect(config.auth.providers).toEqual([]);
    expect(config.encryption).toEqual({
      mode: "server",
      algorithm: "AES-256-GCM",
      keyVersion: "1",
      provider: "local",
    });
    expect(containsSecretField(config)).toBe(false);
  });

  it("advertises the EKM provider and key version without secrets", async () => {
    clearEnv();
    process.env.AULORA_EKM_PROVIDER = "vault";
    process.env.AULORA_ENCRYPTION_KEY_VERSION = "4";

    const t = convexTest(schema, modules);
    const config = await t.query(api.server.publicConfig);

    expect(config.encryption).toEqual({
      mode: "server",
      algorithm: "AES-256-GCM",
      keyVersion: "4",
      provider: "vault",
    });
    expect(containsSecretField(config)).toBe(false);
  });

  it("exposes configured providers but never their secrets", async () => {
    clearEnv();
    process.env.GITHUB_CLIENT_ID = "gh-id";
    process.env.GITHUB_CLIENT_SECRET = "gh-secret-should-not-leak";
    process.env.GOOGLE_CLIENT_ID = "google-id";
    process.env.OIDC_ISSUER = "https://idp.example.com";
    process.env.OIDC_DISCOVERY_URL = "https://idp.example.com/.well-known/openid-configuration";
    process.env.OIDC_CLIENT_ID = "oidc-client";
    process.env.OIDC_CLIENT_SECRET = "oidc-secret-should-not-leak";
    process.env.OIDC_DISPLAY_NAME = "Acme SSO";
    process.env.OIDC_SCOPES = "openid profile email groups";

    const t = convexTest(schema, modules);
    const config = await t.query(api.server.publicConfig);

    expect(config.auth.providers).toHaveLength(2);
    const github = config.auth.providers.find((provider) => provider.id === "github");
    expect(github).toMatchObject({ type: "oauth", displayName: "GitHub" });
    const oidc = config.auth.providers.find((provider) => provider.id === "oidc");
    expect(oidc).toMatchObject({
      type: "oidc",
      displayName: "Acme SSO",
      clientId: "oidc-client",
      scopes: ["openid", "profile", "email", "groups"],
    });
    expect(JSON.stringify(config)).not.toContain("should-not-leak");
    expect(containsSecretField(config)).toBe(false);
  });

  it("uses the stored server name and signup setting", async () => {
    clearEnv();
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("server", {
        name: "Acme",
        iconSeed: "seed",
        ownerId: "owner-1",
        settings: {
          signupEnabled: false,
          inviteOnly: true,
          allowedEmailDomains: [],
          voiceEnabled: true,
          videoEnabled: true,
          screenShareEnabled: true,
          maxCallParticipants: 10,
        },
      });
    });

    const config = await t.query(api.server.publicConfig);
    expect(config.name).toBe("Acme");
    expect(config.auth.local.signup).toBe(false);
  });
});
