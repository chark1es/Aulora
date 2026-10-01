import { containsSecretField } from "@aulora/core";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import { newTest, seedWorkspace } from "./helpers";
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

  it("honors instance auth-provider toggles and reports the access policy", async () => {
    clearEnv();
    process.env.GITHUB_CLIENT_ID = "gh-id";
    process.env.GITHUB_CLIENT_SECRET = "gh-secret";
    const t = newTest();
    await seedWorkspace(t, { ownerId: "owner-1", members: [{ userId: "owner-1" }] });
    const asOwner = t.withIdentity({ subject: "owner-1" });

    const before = await t.query(api.server.publicConfig);
    expect(before.auth.providers.map((provider) => provider.id)).toContain("github");

    await asOwner.mutation(api.instance.updateAuthProviders, { providers: { github: false } });
    const after = await t.query(api.server.publicConfig);
    expect(after.auth.providers.map((provider) => provider.id)).not.toContain("github");

    await asOwner.mutation(api.server.updateSettings, { inviteOnly: false, signupEnabled: false });
    const policy = await t.query(api.server.publicConfig);
    expect(policy).toMatchObject({ inviteOnly: false, signupEnabled: false });
    expect(policy.auth.local.signup).toBe(false);
  });

  it("updates branding under ManageWorkspace and audits the change", async () => {
    clearEnv();
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asOwner = t.withIdentity({ subject: "owner-1" });
    await asOwner.mutation(api.server.updateBranding, {
      name: "Renamed",
      description: "hello",
      iconSeed: "seed-2",
    });

    const config = await t.query(api.server.publicConfig);
    expect(config).toMatchObject({ name: "Renamed", description: "hello" });
    const admin = await asOwner.query(api.server.settings);
    expect(admin).toMatchObject({
      name: "Renamed",
      description: "hello",
      iconSeed: "seed-2",
    });

    const log = await asOwner.query(api.auditLog.list, {
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(log.page.map((row) => row.action)).toContain("server.updateBranding");

    const asUser = t.withIdentity({ subject: "user-1" });
    await expect(asUser.mutation(api.server.updateBranding, { name: "Nope" })).rejects.toThrow(
      "Missing permission",
    );
  });

  it("only accepts a non-empty image asset under the size cap as the logo", async () => {
    clearEnv();
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asOwner = t.withIdentity({ subject: "owner-1" });

    const imageId = await t.run(async (ctx) => {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      return await ctx.storage.store(new Blob([bytes], { type: "image/png" }));
    });
    await asOwner.mutation(api.server.setLogo, { storageId: imageId });
    expect((await asOwner.query(api.server.settings)).logoStorageId).toBe(imageId);

    // An empty object is never a valid logo.
    const emptyId = await t.run(
      async (ctx) => await ctx.storage.store(new Blob([new Uint8Array(0)])),
    );
    await expect(asOwner.mutation(api.server.setLogo, { storageId: emptyId })).rejects.toThrow(
      "image",
    );

    const asUser = t.withIdentity({ subject: "user-1" });
    await expect(asUser.mutation(api.server.setLogo, { storageId: imageId })).rejects.toThrow(
      "Missing permission",
    );
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
