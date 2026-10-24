import type { DBAdapter, Where } from "better-auth/adapters";
import type { BetterAuthOptions } from "better-auth/minimal";
import { describe, expect, it } from "vitest";
import { authComponent, createAuthOptions } from "../convex/auth";
import {
  accountCreatedAtMs,
  getAccountLinkingSettings,
  oidcEmailTrusted,
  revokePreLinkSessions,
} from "../convex/lib/authLinking";
import { newTest } from "./helpers";

const OIDC_ENV = {
  OIDC_ISSUER: "https://idp.example.com",
  OIDC_DISCOVERY_URL: "https://idp.example.com/.well-known/openid-configuration",
  OIDC_CLIENT_ID: "client",
  OIDC_CLIENT_SECRET: "secret",
};

describe("getAccountLinkingSettings", () => {
  it("links OAuth identities to unverified local accounts", () => {
    expect(getAccountLinkingSettings({}, null)).toEqual({
      enabled: true,
      trustedProviders: [],
      requireLocalEmailVerified: false,
      allowDifferentEmails: false,
    });
  });

  it("does not trust the built-in providers by name", () => {
    const env = {
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
      GITHUB_CLIENT_ID: "id",
      GITHUB_CLIENT_SECRET: "secret",
    };
    // Trust would let a provider link even when it reports emailVerified false;
    // without it Better Auth requires the provider's verified-email claim.
    expect(getAccountLinkingSettings(env, null).trustedProviders).toEqual([]);
  });

  it("only trusts OIDC when the operator opts in", () => {
    expect(getAccountLinkingSettings(OIDC_ENV, "oidc").trustedProviders).toEqual([]);
    expect(
      getAccountLinkingSettings({ ...OIDC_ENV, OIDC_TRUST_EMAIL: "true" }, "oidc").trustedProviders,
    ).toEqual(["oidc"]);
  });

  it("ignores the flag when OIDC is not configured", () => {
    expect(getAccountLinkingSettings({ OIDC_TRUST_EMAIL: "true" }, null).trustedProviders).toEqual(
      [],
    );
  });

  it("accepts only the exact value true", () => {
    expect(oidcEmailTrusted({ OIDC_TRUST_EMAIL: "true" })).toBe(true);
    expect(oidcEmailTrusted({ OIDC_TRUST_EMAIL: " TRUE " })).toBe(true);
    for (const value of ["1", "yes", "on", "false", ""]) {
      expect(oidcEmailTrusted({ OIDC_TRUST_EMAIL: value })).toBe(false);
    }
    expect(oidcEmailTrusted({})).toBe(false);
  });
});

describe("accountCreatedAtMs", () => {
  it("reads the numeric timestamp the Convex adapter returns", () => {
    expect(accountCreatedAtMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it("reads a Date and rejects anything else", () => {
    expect(accountCreatedAtMs(new Date(1_700_000_000_000))).toBe(1_700_000_000_000);
    expect(accountCreatedAtMs(undefined)).toBeNull();
    expect(accountCreatedAtMs("now")).toBeNull();
    expect(accountCreatedAtMs(Number.NaN)).toBeNull();
  });
});

describe("revokePreLinkSessions", () => {
  function fakeStore(user: { emailVerified: boolean } | null = { emailVerified: false }) {
    const calls: { model: string; where: Where[] }[] = [];
    const store: Pick<DBAdapter, "deleteMany" | "findOne"> = {
      deleteMany: async (data) => {
        calls.push(data);
        return 3;
      },
      findOne: async <T>() => user as T | null,
    };
    return { calls, store };
  }

  it("keeps sessions when the user had already proven the address", async () => {
    const { calls, store } = fakeStore({ emailVerified: true });
    await revokePreLinkSessions(store, {
      userId: "user-1",
      providerId: "google",
      createdAt: 1_700_000_000_000,
    });
    expect(calls).toEqual([]);
  });

  it("never revokes for the password account itself", async () => {
    const { calls, store } = fakeStore();
    await revokePreLinkSessions(store, {
      userId: "user-1",
      providerId: "credential",
      createdAt: 1_700_000_000_000,
    });
    expect(calls).toEqual([]);
  });

  it("targets the user's sessions older than the account row", async () => {
    const { calls, store } = fakeStore();
    await revokePreLinkSessions(store, {
      userId: "user-1",
      providerId: "google",
      createdAt: 1_700_000_000_000,
    });
    expect(calls).toEqual([
      {
        model: "session",
        where: [
          { field: "userId", value: "user-1" },
          { field: "createdAt", operator: "lt", value: 1_700_000_000_000 },
        ],
      },
    ]);
  });

  it("reads a Date timestamp as well", async () => {
    const { calls, store } = fakeStore();
    await revokePreLinkSessions(store, {
      userId: "user-2",
      providerId: "github",
      createdAt: new Date(1_700_000_000_000),
    });
    expect(calls[0]?.where[1]?.value).toBe(1_700_000_000_000);
  });

  it("leaves sessions alone when the timestamp is missing", async () => {
    const { calls, store } = fakeStore();
    await revokePreLinkSessions(store, { userId: "user-1", providerId: "google" });
    expect(calls).toEqual([]);
  });
});

describe("createAuthOptions account linking", () => {
  async function buildOptions(env: Record<string, string>): Promise<BetterAuthOptions | undefined> {
    const t = newTest();
    let built: BetterAuthOptions | undefined;
    await t.run(async (ctx) => {
      built = createAuthOptions(ctx, new Map(), env);
    });
    return built;
  }

  it("is enabled in the built options for a configured social provider", async () => {
    const options = await buildOptions({
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
    });
    expect(options?.socialProviders?.google).toMatchObject({ clientId: "id" });
    expect(options?.account?.accountLinking).toEqual({
      enabled: true,
      trustedProviders: [],
      requireLocalEmailVerified: false,
      allowDifferentEmails: false,
    });
  });

  it("builds the session store the account hook passes to the revoker", async () => {
    const t = newTest();
    await t.run(async (ctx) => {
      const store = authComponent.adapter(ctx)({});
      expect(typeof store.deleteMany).toBe("function");
    });
  });

  it("adds the configured OIDC provider only with the trust flag", async () => {
    const untrusted = await buildOptions(OIDC_ENV);
    expect(untrusted?.account?.accountLinking?.trustedProviders).toEqual([]);

    const trusted = await buildOptions({ ...OIDC_ENV, OIDC_TRUST_EMAIL: "true" });
    expect(trusted?.account?.accountLinking?.trustedProviders).toEqual(["oidc"]);
  });
});
