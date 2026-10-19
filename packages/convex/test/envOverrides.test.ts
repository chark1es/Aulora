import { afterEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { loadEffectiveEnv } from "../convex/lib/envOverrides";
import { newTest, seedWorkspace } from "./helpers";

/** Environment keys these tests set; cleared after each case. */
function resetEnv(): void {
  delete process.env.GITHUB_CLIENT_ID;
  delete process.env.GITHUB_CLIENT_SECRET;
  delete process.env.OIDC_ISSUER;
  delete process.env.OIDC_DISCOVERY_URL;
  delete process.env.OIDC_CLIENT_ID;
  delete process.env.OIDC_CLIENT_SECRET;
  delete process.env.OIDC_DISPLAY_NAME;
  delete process.env.AULORA_ALLOW_UI_ENV_OVERRIDES;
  delete process.env.AULORA_ENCRYPTION_ENABLED;
  delete process.env.SITE_URL;
  delete process.env.CONVEX_SITE_URL;
}

afterEach(resetEnv);

async function ownerTest() {
  const t = newTest();
  const { serverId } = await seedWorkspace(t, {
    ownerId: "owner-1",
    members: [{ userId: "owner-1" }, { userId: "user-2" }],
  });
  return {
    t,
    serverId,
    asOwner: t.withIdentity({ subject: "owner-1" }),
    asUser: t.withIdentity({ subject: "user-2" }),
  };
}

const OIDC_GROUP = [
  { key: "OIDC_ISSUER", value: "https://ui-idp.example" },
  {
    key: "OIDC_DISCOVERY_URL",
    value: "https://ui-idp.example/.well-known/openid-configuration",
  },
  { key: "OIDC_CLIENT_ID", value: "ui-client" },
  { key: "OIDC_CLIENT_SECRET", value: "ui-client-secret" },
];

describe("envOverrides authority", () => {
  it("rejects anonymous and non-owner callers on every function", async () => {
    const { t, asUser } = await ownerTest();
    await expect(t.query(api.envOverrides.list, {})).rejects.toThrow("Not authenticated");
    await expect(
      t.mutation(api.envOverrides.set, { key: "OIDC_CLIENT_ID", value: "x" }),
    ).rejects.toThrow("Not authenticated");
    await expect(t.mutation(api.envOverrides.clear, { key: "OIDC_CLIENT_ID" })).rejects.toThrow(
      "Not authenticated",
    );
    await expect(asUser.query(api.envOverrides.list, {})).rejects.toThrow("Instance admin only");
    await expect(
      asUser.mutation(api.envOverrides.set, { key: "OIDC_CLIENT_ID", value: "x" }),
    ).rejects.toThrow("Instance admin only");
    await expect(
      asUser.mutation(api.envOverrides.setMany, {
        entries: [{ key: "OIDC_CLIENT_ID", value: "x" }],
      }),
    ).rejects.toThrow("Instance admin only");
    await expect(
      asUser.mutation(api.envOverrides.clear, { key: "OIDC_CLIENT_ID" }),
    ).rejects.toThrow("Instance admin only");
  });
});

describe("envOverrides key and value validation", () => {
  it("rejects unknown, deployment-managed and unparsable keys", async () => {
    const { asOwner } = await ownerTest();
    await expect(
      asOwner.mutation(api.envOverrides.set, { key: "NOT_A_REAL_VAR", value: "x" }),
    ).rejects.toThrow("Unknown environment variable");
    await expect(
      asOwner.mutation(api.envOverrides.set, { key: "BETTER_AUTH_SECRET", value: "x" }),
    ).rejects.toThrow("managed by the deployment");
    await expect(
      asOwner.mutation(api.envOverrides.set, {
        key: "SITE_URL",
        value: "https://other.example.com",
      }),
    ).rejects.toThrow("managed by the deployment");
    await expect(
      asOwner.mutation(api.envOverrides.clear, { key: "BETTER_AUTH_SECRET" }),
    ).rejects.toThrow("managed by the deployment");
  });

  it("validates values per type", async () => {
    const { asOwner } = await ownerTest();
    await expect(
      asOwner.mutation(api.envOverrides.set, { key: "OIDC_ISSUER", value: "ftp://idp.example" }),
    ).rejects.toThrow("https URL");
    await expect(
      asOwner.mutation(api.envOverrides.set, { key: "AUTH_MIN_PASSWORD_LENGTH", value: "0" }),
    ).rejects.toThrow("at least 1");
    await expect(
      asOwner.mutation(api.envOverrides.set, { key: "AUTH_LOCAL_ENABLED", value: "maybe" }),
    ).rejects.toThrow('"true" or "false"');
    await expect(
      asOwner.mutation(api.envOverrides.set, { key: "OIDC_GROUP_ROLE_MAP", value: "{oops" }),
    ).rejects.toThrow("valid JSON");
    await expect(
      asOwner.mutation(api.envOverrides.set, { key: "OIDC_CLIENT_ID", value: "   " }),
    ).rejects.toThrow("Enter a value");
  });
});

describe("envOverrides kill switch and limits", () => {
  it("honours the AULORA_ALLOW_UI_ENV_OVERRIDES kill switch", async () => {
    const { asOwner } = await ownerTest();
    process.env.AULORA_ALLOW_UI_ENV_OVERRIDES = "false";
    const locked = await asOwner.query(api.envOverrides.list, {});
    expect(locked.locked).toBe(true);
    await expect(
      asOwner.mutation(api.envOverrides.set, { key: "OIDC_CLIENT_ID", value: "x" }),
    ).rejects.toThrow("disabled by the deployment");
    await expect(
      asOwner.mutation(api.envOverrides.clear, { key: "OIDC_CLIENT_ID" }),
    ).rejects.toThrow("disabled by the deployment");

    process.env.AULORA_ALLOW_UI_ENV_OVERRIDES = "0";
    expect((await asOwner.query(api.envOverrides.list, {})).locked).toBe(false);
  });
});

describe("envOverrides storage", () => {
  it("stores secrets sealed and never returns them", async () => {
    const { t, asOwner } = await ownerTest();
    const secret = "super-secret-oidc-value";
    await asOwner.mutation(api.envOverrides.set, { key: "OIDC_CLIENT_SECRET", value: secret });

    const row = await t.run(async (ctx) => {
      const rows = await ctx.db.query("envOverrides").collect();
      return rows.find((candidate) => candidate.key === "OIDC_CLIENT_SECRET") ?? null;
    });
    expect(row?.valueCiphertext.startsWith("aulora-sse-")).toBe(true);
    expect(row?.valueCiphertext.includes(secret)).toBe(false);

    const list = await asOwner.query(api.envOverrides.list, {});
    const variable = list.variables.find((entry) => entry.key === "OIDC_CLIENT_SECRET");
    expect(variable?.source).toBe("ui");
    expect(variable?.isSet).toBe(true);
    expect(variable?.secret).toBe(true);
    expect(variable?.value).toBeUndefined();
    expect(JSON.stringify(list)).not.toContain(secret);
  });

  it("never returns deployment environment values", async () => {
    const { asOwner } = await ownerTest();
    process.env.GITHUB_CLIENT_SECRET = "env-secret-abc123";
    process.env.OIDC_DISPLAY_NAME = "Env Only SSO";
    const list = await asOwner.query(api.envOverrides.list, {});
    const json = JSON.stringify(list);
    expect(json).not.toContain("env-secret-abc123");
    expect(json).not.toContain("Env Only SSO");
    const secretRow = list.variables.find((entry) => entry.key === "GITHUB_CLIENT_SECRET");
    expect(secretRow?.source).toBe("environment");
    expect(secretRow?.isSet).toBe(true);
    expect(secretRow?.value).toBeUndefined();
  });
});

describe("envOverrides redirect URLs", () => {
  it("gives each provider client id the callback URL to register", async () => {
    const { asOwner } = await ownerTest();
    process.env.SITE_URL = "https://chat.example.com/";
    const list = await asOwner.query(api.envOverrides.list, {});
    expect(list.siteUrl).toBe("https://chat.example.com");
    const urls = Object.fromEntries(list.variables.map((entry) => [entry.key, entry.redirectUrl]));
    expect(urls.GITHUB_CLIENT_ID).toBe("https://chat.example.com/api/auth/callback/github");
    expect(urls.GOOGLE_CLIENT_ID).toBe("https://chat.example.com/api/auth/callback/google");
    expect(urls.OIDC_CLIENT_ID).toBe("https://chat.example.com/api/auth/oauth2/callback/oidc");
    expect(urls.GITHUB_CLIENT_SECRET).toBeNull();
    expect(urls.OIDC_ISSUER).toBeNull();
  });

  it("reports no redirect URL when the site origin is unknown", async () => {
    const { asOwner } = await ownerTest();
    const list = await asOwner.query(api.envOverrides.list, {});
    expect(list.siteUrl).toBeNull();
    expect(list.variables.every((entry) => entry.redirectUrl === null)).toBe(true);
  });
});

describe("envOverrides precedence and reset", () => {
  it("lets an override win over a set deployment value", async () => {
    const { t, asOwner } = await ownerTest();
    process.env.GITHUB_CLIENT_ID = "env-id";
    process.env.GITHUB_CLIENT_SECRET = "env-secret";
    await asOwner.mutation(api.envOverrides.set, { key: "GITHUB_CLIENT_ID", value: "ui-id" });

    const list = await asOwner.query(api.envOverrides.list, {});
    const variable = list.variables.find((entry) => entry.key === "GITHUB_CLIENT_ID");
    expect(variable?.source).toBe("ui");
    expect(variable?.value).toBe("ui-id");
    expect(JSON.stringify(list)).not.toContain("env-id");

    const effective = await t.run(
      async (ctx) => (await loadEffectiveEnv(ctx)).env.GITHUB_CLIENT_ID,
    );
    const untouched = await t.run(
      async (ctx) => (await loadEffectiveEnv(ctx)).env.GITHUB_CLIENT_SECRET,
    );
    expect(effective).toBe("ui-id");
    // The deployment secret is dropped rather than paired with the UI id.
    expect(untouched ?? null).toBeNull();
  });

  it("restores the deployment value on reset without exposing anything", async () => {
    const { t, asOwner } = await ownerTest();
    process.env.GITHUB_CLIENT_ID = "env-id";
    await asOwner.mutation(api.envOverrides.set, { key: "GITHUB_CLIENT_ID", value: "ui-id" });
    await asOwner.mutation(api.envOverrides.clear, { key: "GITHUB_CLIENT_ID" });

    const list = await asOwner.query(api.envOverrides.list, {});
    const variable = list.variables.find((entry) => entry.key === "GITHUB_CLIENT_ID");
    expect(variable?.source).toBe("environment");
    expect(variable?.value).toBeUndefined();
    expect(JSON.stringify(list)).not.toContain("env-id");
    expect(JSON.stringify(list)).not.toContain("ui-id");

    const effective = await t.run(
      async (ctx) => (await loadEffectiveEnv(ctx)).env.GITHUB_CLIENT_ID,
    );
    expect(effective).toBe("env-id");
    const remaining = await t.run(async (ctx) => await ctx.db.query("envOverrides").collect());
    expect(remaining).toHaveLength(0);
  });
});

describe("envOverrides batches and safety rails", () => {
  it("saves an OIDC group atomically and rejects duplicates or bad entries", async () => {
    const { t, asOwner } = await ownerTest();
    await asOwner.mutation(api.envOverrides.setMany, { entries: OIDC_GROUP });
    const rows = await t.run(async (ctx) => await ctx.db.query("envOverrides").collect());
    expect(rows).toHaveLength(4);

    const issuerEntry = { key: "OIDC_ISSUER", value: "https://ui-idp.example" };
    await expect(
      asOwner.mutation(api.envOverrides.setMany, { entries: [issuerEntry, issuerEntry] }),
    ).rejects.toThrow("Duplicate environment variable");
    await expect(
      asOwner.mutation(api.envOverrides.setMany, {
        entries: [issuerEntry, { key: "OIDC_CLIENT_ID", value: "" }],
      }),
    ).rejects.toThrow("Enter a value");
    const after = await t.run(async (ctx) => await ctx.db.query("envOverrides").collect());
    expect(after).toHaveLength(4);
  });

  it("refuses to store anything when encryption is not configured", async () => {
    const { asOwner } = await ownerTest();
    process.env.AULORA_ENCRYPTION_ENABLED = "false";
    const list = await asOwner.query(api.envOverrides.list, {});
    expect(list.encryptionConfigured).toBe(false);
    await expect(
      asOwner.mutation(api.envOverrides.set, { key: "OIDC_CLIENT_ID", value: "x" }),
    ).rejects.toThrow("encryption is not configured");
  });

  it("rate limits override writes", async () => {
    const { asOwner } = await ownerTest();
    for (let index = 0; index < 30; index += 1) {
      await asOwner.mutation(api.envOverrides.set, {
        key: "OIDC_DISPLAY_NAME",
        value: `name-${index}`,
      });
    }
    await expect(
      asOwner.mutation(api.envOverrides.set, { key: "OIDC_DISPLAY_NAME", value: "one-too-many" }),
    ).rejects.toThrow("Rate limit exceeded");
  });
});

describe("envOverrides audit trail", () => {
  it("records key names only, never values", async () => {
    const { t, asOwner } = await ownerTest();
    const secret = "audit-secret-value-xyz";
    await asOwner.mutation(api.envOverrides.set, { key: "OIDC_CLIENT_SECRET", value: secret });
    await asOwner.mutation(api.envOverrides.set, { key: "GITHUB_CLIENT_ID", value: "ui-audit-id" });
    await asOwner.mutation(api.envOverrides.clear, { key: "OIDC_CLIENT_SECRET" });

    const rows = await t.run(async (ctx) =>
      (await ctx.db.query("auditLog").collect()).filter((row) =>
        row.action.startsWith("instance.env"),
      ),
    );
    expect(rows.map((row) => row.action)).toEqual([
      "instance.env.override",
      "instance.env.override",
      "instance.env.reset",
    ]);
    for (const row of rows) {
      expect(row.meta ?? "").not.toContain(secret);
      expect(row.meta ?? "").not.toContain("ui-audit-id");
    }
    expect(rows[0]?.meta).toContain("OIDC_CLIENT_SECRET");
    expect(rows[2]?.meta).toContain("OIDC_CLIENT_SECRET");
  });
});
