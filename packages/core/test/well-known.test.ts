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
