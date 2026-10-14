import type { BetterAuthOptions } from "better-auth/minimal";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { createAuthOptions } from "../convex/auth";
import { loadEffectiveEnv } from "../convex/lib/envOverrides";
import { newTest, seedWorkspace } from "./helpers";

function resetEnv(): void {
  delete process.env.GITHUB_CLIENT_ID;
  delete process.env.GITHUB_CLIENT_SECRET;
  delete process.env.OIDC_ISSUER;
  delete process.env.OIDC_DISCOVERY_URL;
  delete process.env.OIDC_CLIENT_ID;
  delete process.env.OIDC_CLIENT_SECRET;
  delete process.env.OIDC_DISPLAY_NAME;
  delete process.env.AULORA_EMAIL_FROM;
  delete process.env.RESEND_API_KEY;
}

afterEach(resetEnv);

async function ownerTest() {
  const t = newTest();
  await seedWorkspace(t, {
    ownerId: "owner-1",
    members: [{ userId: "owner-1" }],
  });
  return { t, asOwner: t.withIdentity({ subject: "owner-1" }) };
}

const OIDC_GROUP = [
  { key: "OIDC_DISPLAY_NAME", value: "UI SSO" },
  { key: "OIDC_ISSUER", value: "https://ui-idp.example" },
  {
    key: "OIDC_DISCOVERY_URL",
    value: "https://ui-idp.example/.well-known/openid-configuration",
  },
  { key: "OIDC_CLIENT_ID", value: "ui-client" },
  { key: "OIDC_CLIENT_SECRET", value: "ui-client-secret" },
];

function setEnvOidc(): void {
  process.env.OIDC_ISSUER = "https://env-idp.example";
  process.env.OIDC_DISCOVERY_URL = "https://env-idp.example/.well-known/openid-configuration";
  process.env.OIDC_CLIENT_ID = "env-client";
  process.env.OIDC_CLIENT_SECRET = "env-client-secret";
}

describe("public config with UI overrides", () => {
  it("advertises an OIDC provider saved in the UI", async () => {
    const { t, asOwner } = await ownerTest();
    await asOwner.mutation(api.envOverrides.setMany, { entries: OIDC_GROUP });

    const config = await t.query(api.server.publicConfig);
    const provider = config.auth.providers.find((entry) => entry.id === "oidc");
    expect(provider).toMatchObject({
      type: "oidc",
      displayName: "UI SSO",
      issuer: "https://ui-idp.example",
      discoveryUrl: "https://ui-idp.example/.well-known/openid-configuration",
      clientId: "ui-client",
    });
  });

  it("lets UI credentials win over the deployment env", async () => {
    const { t, asOwner } = await ownerTest();
    process.env.GITHUB_CLIENT_ID = "env-client-id";
    process.env.GITHUB_CLIENT_SECRET = "env-client-secret";
    await asOwner.mutation(api.envOverrides.set, {
      key: "GITHUB_CLIENT_ID",
      value: "ui-github-id",
    });
    await asOwner.mutation(api.envOverrides.set, {
      key: "GITHUB_CLIENT_SECRET",
      value: "ui-github-secret",
    });

    const config = await t.query(api.server.publicConfig);
    const provider = config.auth.providers.find((entry) => entry.id === "github");
    expect(provider).toMatchObject({ type: "oauth", displayName: "GitHub" });
    // The well-known document never carries the secret; only the presence matters.
    expect(JSON.stringify(config)).not.toContain("ui-github-secret");
    expect(JSON.stringify(config)).not.toContain("env-client-secret");
  });
});

describe("well-known discovery with UI overrides", () => {
  it("publishes a UI-defined OIDC provider through the well-known document", async () => {
    const { t, asOwner } = await ownerTest();
    await asOwner.mutation(api.envOverrides.setMany, { entries: OIDC_GROUP });

    const response = await t.fetch("/.well-known/aulora.json");
    const document = await response.json();
    const provider = document.auth.providers.find((entry: { id: string }) => entry.id === "oidc");
    expect(provider).toMatchObject({
      id: "oidc",
      type: "oidc",
      issuer: "https://ui-idp.example",
      clientId: "ui-client",
    });
    expect(JSON.stringify(document)).not.toContain("ui-client-secret");
  });
});

describe("instance overview disclosure", () => {
  it("hides environment-sourced OIDC and mail values", async () => {
    const { asOwner } = await ownerTest();
    setEnvOidc();
    process.env.AULORA_EMAIL_FROM = "Env Team <env@example.com>";
    process.env.RESEND_API_KEY = "re_env_key";

    const overview = await asOwner.query(api.instance.overview, {});
    expect(overview.auth.oidc).toEqual({ source: "environment" });
    expect(overview.email).toEqual({ provider: "none", from: "", configured: true });
    const json = JSON.stringify(overview);
    expect(json).not.toContain("env-idp.example");
    expect(json).not.toContain("env-client");
    expect(json).not.toContain("env@example.com");
    expect(json).not.toContain("re_env_key");
  });

  it("echoes UI-saved OIDC values for editing", async () => {
    const { asOwner } = await ownerTest();
    setEnvOidc();
    await asOwner.mutation(api.envOverrides.setMany, { entries: OIDC_GROUP });

    const overview = await asOwner.query(api.instance.overview, {});
    expect(overview.auth.oidc).toEqual({
      source: "ui",
      displayName: "UI SSO",
      issuer: "https://ui-idp.example",
      discoveryUrl: "https://ui-idp.example/.well-known/openid-configuration",
      scopes: ["openid", "profile", "email"],
    });
    expect(JSON.stringify(overview)).not.toContain("env-idp.example");
  });
});

interface GenericOAuthPlugin {
  readonly id?: string;
  readonly init?: (ctx: unknown) => {
    readonly context?: {
      readonly socialProviders?: readonly ({ readonly id?: string } | undefined)[];
    };
  };
}

describe("Better Auth options from the effective environment", () => {
  it("configures social credentials and the generic OIDC plugin", async () => {
    const { t, asOwner } = await ownerTest();
    await asOwner.mutation(api.envOverrides.setMany, {
      entries: [
        ...OIDC_GROUP,
        { key: "GITHUB_CLIENT_ID", value: "ui-github-id" },
        { key: "GITHUB_CLIENT_SECRET", value: "ui-github-secret" },
      ],
    });
    const env = await t.run(async (ctx) => (await loadEffectiveEnv(ctx)).env);
    let built: BetterAuthOptions | undefined;
    await t.run(async (ctx) => {
      built = createAuthOptions(ctx, new Map(), env);
    });
    if (built === undefined) {
      throw new Error("auth options were not built");
    }
    const options = built;

    const social = options.socialProviders as Record<string, { clientId?: string }> | undefined;
    expect(social?.github?.clientId).toBe("ui-github-id");

    const plugin = (options.plugins ?? []).find(
      (entry) => (entry as GenericOAuthPlugin).id === "generic-oauth",
    ) as GenericOAuthPlugin | undefined;
    expect(plugin).toBeDefined();
    const initialized = plugin?.init?.({});
    const providerIds = (initialized?.context?.socialProviders ?? []).map(
      (provider) => provider?.id,
    );
    expect(providerIds).toContain("oidc");
  });

  it("omits the OIDC plugin when nothing configures it", async () => {
    const { t } = await ownerTest();
    let built: BetterAuthOptions | undefined;
    await t.run(async (ctx) => {
      built = createAuthOptions(ctx, new Map(), {});
    });
    if (built === undefined) {
      throw new Error("auth options were not built");
    }
    const plugin = (built.plugins ?? []).find(
      (entry) => (entry as GenericOAuthPlugin).id === "generic-oauth",
    );
    expect(plugin).toBeUndefined();
  });
});
