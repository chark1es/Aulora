import { describe, expect, it } from "vitest";
import { ServerUrlError } from "../src/server-url";
import {
  containsSecretField,
  fetchWellKnown,
  isWellKnown,
  parseWellKnown,
  WellKnownError,
} from "../src/well-known";

const validWellKnown = {
  name: "Acme Chat",
  version: "0.1.0",
  apiVersion: 1,
  convexUrl: "https://convex.acme.com",
  siteUrl: "https://chat.acme.com",
  iconSeed: "aulora:server:acme",
  auth: {
    local: { enabled: true, signup: false },
    providers: [
      { id: "github", type: "oauth", displayName: "GitHub" },
      {
        id: "keycloak",
        type: "oidc",
        displayName: "Keycloak",
        issuer: "https://idp.acme.com/realms/acme",
        discoveryUrl: "https://idp.acme.com/realms/acme/.well-known/openid-configuration",
        clientId: "aulora",
        scopes: ["openid", "email", "profile"],
      },
    ],
  },
  encryption: {
    mode: "server" as const,
    algorithm: "AES-256-GCM",
    keyVersion: "1",
    provider: "local",
  },
};

describe("parseWellKnown", () => {
  it("accepts the exact documented contract", () => {
    expect(isWellKnown(validWellKnown)).toBe(true);
    expect(parseWellKnown(validWellKnown)).toEqual(validWellKnown);
  });

  it("accepts an empty provider list and local-only auth", () => {
    const doc = {
      ...validWellKnown,
      auth: { local: { enabled: false, signup: false }, providers: [] },
    };
    expect(isWellKnown(doc)).toBe(true);
  });

  it("accepts an optional local password minimum", () => {
    const doc = {
      ...validWellKnown,
      auth: {
        ...validWellKnown.auth,
        local: { enabled: true, signup: false, minPasswordLength: 12 },
      },
    };
    expect(parseWellKnown(doc).auth.local.minPasswordLength).toBe(12);
    expect(
      isWellKnown({
        ...validWellKnown,
        auth: {
          ...validWellKnown.auth,
          local: { enabled: true, signup: false, minPasswordLength: 0 },
        },
      }),
    ).toBe(false);
  });

  it("accepts an absent encryption block", () => {
    const { encryption: _encryption, ...withoutEncryption } = validWellKnown;
    expect(isWellKnown(withoutEncryption)).toBe(true);
  });

  it("rejects malformed encryption blocks", () => {
    expect(
      isWellKnown({
        ...validWellKnown,
        encryption: { ...validWellKnown.encryption, mode: "client" },
      }),
    ).toBe(false);
    expect(
      isWellKnown({
        ...validWellKnown,
        encryption: { ...validWellKnown.encryption, keyVersion: 1 },
      }),
    ).toBe(false);
    expect(
      isWellKnown({ ...validWellKnown, encryption: { ...validWellKnown.encryption, extra: true } }),
    ).toBe(false);
    expect(isWellKnown({ ...validWellKnown, encryption: null })).toBe(false);
  });

  it("rejects secret-shaped fields inside the encryption block", () => {
    const doc = {
      ...validWellKnown,
      encryption: { ...validWellKnown.encryption, privateKey: "s3cr3t" },
    };
    expect(isWellKnown(doc)).toBe(false);
    expect(() => parseWellKnown(doc)).toThrow(expect.objectContaining({ code: "SECRET_FIELD" }));
  });

  it("rejects missing required fields", () => {
    const { name: _name, ...withoutName } = validWellKnown;
    expect(isWellKnown(withoutName)).toBe(false);
    expect(() => parseWellKnown(withoutName)).toThrow(WellKnownError);

    const withoutAuth = { ...validWellKnown, auth: undefined };
    expect(isWellKnown(withoutAuth)).toBe(false);
  });

  it("rejects wrong field types", () => {
    expect(isWellKnown({ ...validWellKnown, apiVersion: "1" })).toBe(false);
    expect(isWellKnown({ ...validWellKnown, version: 1 })).toBe(false);
    expect(isWellKnown({ ...validWellKnown, iconSeed: "" })).toBe(false);
    expect(isWellKnown({ ...validWellKnown, auth: { ...validWellKnown.auth, local: {} } })).toBe(
      false,
    );
    expect(isWellKnown({ ...validWellKnown, auth: { local: { enabled: true } } })).toBe(false);
  });

  it("rejects unknown fields instead of silently copying them", () => {
    expect(isWellKnown({ ...validWellKnown, logoUrl: "https://acme.com/logo.png" })).toBe(false);
    expect(isWellKnown({ ...validWellKnown, extra: { nested: true } })).toBe(false);
  });

  it("rejects malformed providers", () => {
    expect(
      isWellKnown({
        ...validWellKnown,
        auth: { ...validWellKnown.auth, providers: [{ id: "x", type: "saml" }] },
      }),
    ).toBe(false);
    expect(
      isWellKnown({
        ...validWellKnown,
        auth: {
          ...validWellKnown.auth,
          providers: [{ id: "x", type: "oidc", displayName: "X" }],
        },
      }),
    ).toBe(false);
    expect(
      isWellKnown({
        ...validWellKnown,
        auth: {
          ...validWellKnown.auth,
          providers: [
            {
              id: "x",
              type: "oidc",
              displayName: "X",
              issuer: "https://idp",
              discoveryUrl: "https://idp/.well-known/openid-configuration",
              clientId: "aulora",
              scopes: "openid",
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it("accepts clientId but rejects every secret-shaped field", () => {
    const secrets: Array<Record<string, unknown>> = [
      { clientSecret: "s3cr3t" },
      { client_secret: "s3cr3t" },
      { secret: "s3cr3t" },
      { adminKey: "s3cr3t" },
      { privateKey: "s3cr3t" },
      { token: "s3cr3t" },
      { accessToken: "s3cr3t" },
      { apiKey: "s3cr3t" },
      { password: "s3cr3t" },
    ];
    for (const extra of secrets) {
      const doc = { ...validWellKnown, ...extra };
      expect(isWellKnown(doc), JSON.stringify(extra)).toBe(false);
      expect(() => parseWellKnown(doc), JSON.stringify(extra)).toThrow(
        expect.objectContaining({ code: "SECRET_FIELD" }),
      );
      expect(containsSecretField(doc)).toBe(true);
    }
  });

  it("rejects secrets nested in providers and arrays", () => {
    const nestedProvider = {
      ...validWellKnown,
      auth: {
        ...validWellKnown.auth,
        providers: [
          {
            id: "keycloak",
            type: "oidc",
            displayName: "Keycloak",
            issuer: "https://idp.acme.com",
            discoveryUrl: "https://idp.acme.com/.well-known/openid-configuration",
            clientId: "aulora",
            clientSecret: "s3cr3t",
            scopes: ["openid"],
          },
        ],
      },
    };
    expect(isWellKnown(nestedProvider)).toBe(false);
    expect(() => parseWellKnown(nestedProvider)).toThrow(
      expect.objectContaining({ code: "SECRET_FIELD" }),
    );

    const nestedList = { ...validWellKnown, random: [{ nested: { adminKey: "s3cr3t" } }] };
    expect(containsSecretField(nestedList)).toBe(true);
  });

  it("does not echo payload values in error messages", () => {
    try {
      parseWellKnown({ ...validWellKnown, token: "super-secret-value" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(WellKnownError);
      expect(String((error as Error).message)).not.toContain("super-secret-value");
    }
  });
});

describe("discovery compatibility with the previous release's strict parser", () => {
  /**
   * A literal copy of the strict key check from the 1.4.0 release
   * (`packages/core/src/well-known.ts` at HEAD). It rejects any `auth.local`
   * field other than `enabled` and `signup`, so the current server must not
   * publish `minPasswordLength` in `/.well-known/aulora.json`.
   */
  const OLD_LOCAL_KEYS = new Set(["enabled", "signup"]);

  function assertOldLocalKeys(value: unknown): void {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("auth.local must be an object");
    }
    for (const key of Object.keys(value)) {
      if (!OLD_LOCAL_KEYS.has(key)) {
        throw new Error(`auth.local.${key} must be a known field`);
      }
    }
  }

  it("accepts the document the current server publishes", () => {
    // http.ts now builds auth.local from only `enabled` and `signup`.
    const published = {
      ...validWellKnown,
      auth: {
        local: { enabled: true, signup: false },
        providers: validWellKnown.auth.providers,
      },
    };
    expect(() => assertOldLocalKeys(published.auth.local)).not.toThrow();
    expect(isWellKnown(published)).toBe(true);
  });

  it("would reject the newly added key, which is why it stays out of discovery", () => {
    expect(() =>
      assertOldLocalKeys({ enabled: true, signup: false, minPasswordLength: 12 }),
    ).toThrow("minPasswordLength");
  });

  it("still accepts the key if a future document carries it", () => {
    const doc = {
      ...validWellKnown,
      auth: {
        ...validWellKnown.auth,
        local: { enabled: true, signup: false, minPasswordLength: 12 },
      },
    };
    expect(parseWellKnown(doc).auth.local.minPasswordLength).toBe(12);
  });
});

describe("fetchWellKnown", () => {
  it("fetches the well-known URL and returns a typed document", async () => {
    let calledUrl = "";
    const fetchImpl = (async (input: unknown) => {
      calledUrl = String(input);
      return new Response(JSON.stringify(validWellKnown), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await fetchWellKnown("chat.acme.com/", { fetchImpl });
    expect(calledUrl).toBe("https://chat.acme.com/.well-known/aulora.json");
    expect(result).toEqual(validWellKnown);
  });

  it("maps HTTP failures to an HTTP_ERROR", async () => {
    const fetchImpl = (async () =>
      new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(fetchWellKnown("chat.acme.com", { fetchImpl })).rejects.toMatchObject({
      code: "HTTP_ERROR",
    });
  });

  it("maps invalid JSON to INVALID_JSON", async () => {
    const fetchImpl = (async () =>
      new Response("<html>not json</html>", { status: 200 })) as unknown as typeof fetch;
    await expect(fetchWellKnown("chat.acme.com", { fetchImpl })).rejects.toMatchObject({
      code: "INVALID_JSON",
    });
  });

  it("maps transport failures to NETWORK_ERROR", async () => {
    const fetchImpl = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(fetchWellKnown("chat.acme.com", { fetchImpl })).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });

  it("rejects secret payloads and never logs them", async () => {
    const messages: unknown[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      messages.push(...args);
    };
    try {
      const fetchImpl = (async () =>
        new Response(JSON.stringify({ ...validWellKnown, token: "leak-me" }), {
          status: 200,
        })) as unknown as typeof fetch;
      await expect(fetchWellKnown("chat.acme.com", { fetchImpl })).rejects.toMatchObject({
        code: "SECRET_FIELD",
      });
    } finally {
      console.log = originalLog;
    }
    expect(messages.join(" ")).not.toContain("leak-me");
  });

  it("validates the base URL before fetching", async () => {
    await expect(fetchWellKnown("")).rejects.toBeInstanceOf(ServerUrlError);
  });
});
