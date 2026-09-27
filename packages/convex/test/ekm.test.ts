import { describe, expect, it } from "vitest";
import {
  createEkmClient,
  deriveLocalMasterKey,
  EkmKeyUnavailableError,
  ekmConfigured,
  getEkmSettings,
} from "../convex/lib/ekm";

const KEY = new Uint8Array(32).fill(7);
const KEY_B64 = (() => {
  let binary = "";
  for (const byte of KEY) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
})();

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function fakeFetch(response: Response, calls: Call[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return response;
  }) as typeof fetch;
}

function headersOf(call: Call | undefined): Record<string, string> {
  return (call?.init.headers ?? {}) as Record<string, string>;
}

describe("getEkmSettings", () => {
  it("defaults to the local provider", () => {
    expect(getEkmSettings({})).toEqual({
      provider: "local",
      kekId: "aulora-kek",
      keyVersion: "1",
      vaultMount: "transit",
    });
  });

  it("falls back to local for an unknown provider", () => {
    expect(getEkmSettings({ AULORA_EKM_PROVIDER: "wat" }).provider).toBe("local");
  });

  it("parses vault settings with defaults", () => {
    const settings = getEkmSettings({
      AULORA_EKM_PROVIDER: "vault",
      VAULT_ADDR: "https://vault.example.com",
      VAULT_TOKEN: "token",
      VAULT_NAMESPACE: "team-a",
    });
    expect(settings).toMatchObject({
      provider: "vault",
      vaultAddr: "https://vault.example.com",
      vaultToken: "token",
      vaultNamespace: "team-a",
      vaultMount: "transit",
    });
  });

  it("parses aws, gcp, http and direct key settings", () => {
    expect(
      getEkmSettings({
        AULORA_EKM_PROVIDER: "aws-kms",
        AWS_REGION: "eu-west-1",
        AWS_KMS_KEY_ID: "arn:aws:kms:...",
        AULORA_KEK_WRAPPED: "d3JhcHBlZA==",
      }),
    ).toMatchObject({
      provider: "aws-kms",
      awsRegion: "eu-west-1",
      awsKmsKeyId: "arn:aws:kms:...",
      wrappedKek: "d3JhcHBlZA==",
    });

    expect(
      getEkmSettings({
        AULORA_EKM_PROVIDER: "gcp-kms",
        GCP_KMS_KEY_NAME: "projects/p/locations/l/keyRings/r/cryptoKeys/k",
        AULORA_KEK_WRAPPED: "d3JhcHBlZA==",
      }),
    ).toMatchObject({
      provider: "gcp-kms",
      gcpKmsKeyName: "projects/p/locations/l/keyRings/r/cryptoKeys/k",
      wrappedKek: "d3JhcHBlZA==",
    });

    expect(
      getEkmSettings({
        AULORA_EKM_PROVIDER: "http",
        EKM_PROXY_URL: "https://ekm.example.com/",
        EKM_PROXY_TOKEN: "proxy-token",
        AULORA_KEK_WRAPPED: "d3JhcHBlZA==",
      }),
    ).toMatchObject({
      provider: "http",
      proxyUrl: "https://ekm.example.com/",
      proxyToken: "proxy-token",
      wrappedKek: "d3JhcHBlZA==",
    });

    expect(getEkmSettings({ AULORA_ENCRYPTION_KEY: "abcdef" }).directKek).toBe("abcdef");
  });

  it("respects the key id and version env vars", () => {
    expect(
      getEkmSettings({
        AULORA_EKM_KEY_ID: "my-kek",
        AULORA_ENCRYPTION_KEY_VERSION: "4",
      }),
    ).toMatchObject({ kekId: "my-kek", keyVersion: "4" });
  });
});

describe("ekmConfigured", () => {
  it("requires the provider-specific pieces", () => {
    expect(ekmConfigured({ provider: "local", kekId: "k", keyVersion: "1" })).toBe(false);
    expect(
      ekmConfigured({ provider: "local", kekId: "k", keyVersion: "1", directKek: "abc" }),
    ).toBe(true);

    expect(ekmConfigured({ provider: "http", kekId: "k", keyVersion: "1" })).toBe(false);
    expect(
      ekmConfigured({
        provider: "http",
        kekId: "k",
        keyVersion: "1",
        proxyUrl: "https://ekm",
        wrappedKek: "d3JhcHBlZA==",
      }),
    ).toBe(true);

    expect(
      ekmConfigured({
        provider: "vault",
        kekId: "k",
        keyVersion: "1",
        vaultAddr: "https://vault",
        vaultToken: "t",
        wrappedKek: "d3JhcHBlZA==",
      }),
    ).toBe(true);

    expect(
      ekmConfigured({
        provider: "aws-kms",
        kekId: "k",
        keyVersion: "1",
        awsRegion: "us-east-1",
        awsKmsKeyId: "arn",
        wrappedKek: "d3JhcHBlZA==",
      }),
    ).toBe(true);

    expect(
      ekmConfigured({
        provider: "gcp-kms",
        kekId: "k",
        keyVersion: "1",
        gcpKmsKeyName: "projects/p/...",
        wrappedKek: "d3JhcHBlZA==",
      }),
    ).toBe(true);
  });
});

describe("createEkmClient", () => {
  it("has no unwrap for the local provider", () => {
    const client = createEkmClient({ provider: "local", kekId: "k", keyVersion: "1" });
    expect(client.provider).toBe("local");
    expect(client.unwrap).toBeUndefined();
  });

  it("unwraps through the HTTP proxy", async () => {
    const calls: Call[] = [];
    const client = createEkmClient(
      {
        provider: "http",
        kekId: "aulora-kek",
        keyVersion: "1",
        proxyUrl: "https://ekm.example.com/",
        proxyToken: "proxy-token",
        wrappedKek: "d3JhcHBlZA==",
      },
      { fetch: fakeFetch(new Response(JSON.stringify({ key: KEY_B64 })), calls) },
    );
    const unwrap = client.unwrap;
    expect(unwrap).toBeDefined();
    const bytes = await unwrap?.();
    expect(bytes).toEqual(KEY);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://ekm.example.com/v1/unwrap");
    expect(headersOf(calls[0]).authorization).toBe("Bearer proxy-token");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      wrappedKey: "d3JhcHBlZA==",
      kekId: "aulora-kek",
    });
  });

  it("unwraps through Vault Transit", async () => {
    const calls: Call[] = [];
    const client = createEkmClient(
      {
        provider: "vault",
        kekId: "aulora-kek",
        keyVersion: "1",
        vaultAddr: "https://vault.example.com/",
        vaultToken: "vault-token",
        vaultMount: "transit",
        wrappedKek: "dmF1bHQ6djE6...",
      },
      { fetch: fakeFetch(new Response(JSON.stringify({ data: { plaintext: KEY_B64 } })), calls) },
    );
    const bytes = await client.unwrap?.();
    expect(bytes).toEqual(KEY);
    expect(calls[0]?.url).toBe("https://vault.example.com/v1/transit/decrypt/aulora-kek");
    expect(headersOf(calls[0])["x-vault-token"]).toBe("vault-token");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ ciphertext: "dmF1bHQ6djE6..." });
  });

  it("unwraps through GCP KMS with the convenience bearer", async () => {
    const calls: Call[] = [];
    const client = createEkmClient(
      {
        provider: "gcp-kms",
        kekId: "aulora-kek",
        keyVersion: "1",
        gcpKmsKeyName: "projects/p/locations/l/keyRings/r/cryptoKeys/k",
        proxyToken: "access-token",
        wrappedKek: "d3JhcHBlZA==",
      },
      { fetch: fakeFetch(new Response(JSON.stringify({ plaintext: KEY_B64 })), calls) },
    );
    const bytes = await client.unwrap?.();
    expect(bytes).toEqual(KEY);
    expect(calls[0]?.url).toBe("projects/p/locations/l/keyRings/r/cryptoKeys/k:decrypt");
    expect(headersOf(calls[0]).authorization).toBe("Bearer access-token");
  });

  it("throws a typed error when configuration is missing", async () => {
    const http = createEkmClient({ provider: "http", kekId: "k", keyVersion: "1" });
    await expect(http.unwrap?.()).rejects.toBeInstanceOf(EkmKeyUnavailableError);

    const vault = createEkmClient({
      provider: "vault",
      kekId: "k",
      keyVersion: "1",
      vaultAddr: "https://vault",
    });
    await expect(vault.unwrap?.()).rejects.toBeInstanceOf(EkmKeyUnavailableError);
  });

  it("refuses AWS KMS without an injected signing fetch", async () => {
    const client = createEkmClient({
      provider: "aws-kms",
      kekId: "k",
      keyVersion: "1",
      awsRegion: "us-east-1",
      awsKmsKeyId: "arn",
      wrappedKek: "d3JhcHBlZA==",
    });
    await expect(client.unwrap?.()).rejects.toBeInstanceOf(EkmKeyUnavailableError);
  });

  it("surfaces a non-ok remote response as a typed error", async () => {
    const client = createEkmClient(
      {
        provider: "http",
        kekId: "k",
        keyVersion: "1",
        proxyUrl: "https://ekm.example.com",
        wrappedKek: "d3JhcHBlZA==",
      },
      { fetch: fakeFetch(new Response("nope", { status: 500 }), []) },
    );
    await expect(client.unwrap?.()).rejects.toBeInstanceOf(EkmKeyUnavailableError);
  });
});

describe("deriveLocalMasterKey", () => {
  it("accepts a base64 32-byte key and rejects any other size", async () => {
    const ok = await deriveLocalMasterKey(
      {},
      {
        provider: "local",
        kekId: "k",
        keyVersion: "1",
        directKek: KEY_B64,
      },
    );
    expect(ok).toHaveLength(32);

    await expect(
      deriveLocalMasterKey(
        {},
        {
          provider: "local",
          kekId: "k",
          keyVersion: "1",
          directKek: "AAAA",
        },
      ),
    ).rejects.toBeInstanceOf(EkmKeyUnavailableError);
  });
});
