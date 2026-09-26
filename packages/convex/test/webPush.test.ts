import { afterEach, describe, expect, it } from "vitest";
import {
  base64UrlToBytes,
  buildVapidJwt,
  bytesToBase64Url,
  parseSubscription,
  sendWebPush,
  type VapidConfig,
  vapidConfigFromEnv,
} from "../convex/lib/webPush";

interface GeneratedKeys {
  readonly config: VapidConfig;
  readonly verifyKey: CryptoKey;
}

/** Generates a real P-256 VAPID pair and exposes the public half for verify. */
async function makeVapidKeys(): Promise<GeneratedKeys> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const rawPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (privateJwk.d === undefined) {
    throw new Error("generated key is missing its private scalar");
  }
  return {
    config: {
      publicKey: bytesToBase64Url(rawPublic),
      privateKey: privateJwk.d,
      subject: "mailto:owner@example.com",
    },
    verifyKey: pair.publicKey,
  };
}

const SUBSCRIPTION = {
  endpoint: "https://push.example.com/send/abc123",
  keys: { p256dh: "p256dh-value", auth: "auth-value" },
};

afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});

describe("parseSubscription", () => {
  it("parses a browser PushSubscription JSON payload", () => {
    expect(parseSubscription(JSON.stringify(SUBSCRIPTION))).toEqual(SUBSCRIPTION);
  });

  it("rejects malformed or incomplete payloads", () => {
    expect(parseSubscription("not json")).toBeNull();
    expect(parseSubscription(JSON.stringify({ endpoint: "" }))).toBeNull();
    expect(
      parseSubscription(JSON.stringify({ endpoint: "https://x", keys: { p256dh: "a" } })),
    ).toBeNull();
  });
});

describe("vapidConfigFromEnv", () => {
  it("returns null without both keys", () => {
    expect(vapidConfigFromEnv({})).toBeNull();
    expect(vapidConfigFromEnv({ VAPID_PUBLIC_KEY: "abc" })).toBeNull();
  });

  it("defaults the subject", () => {
    const config = vapidConfigFromEnv({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" });
    expect(config).toEqual({
      publicKey: "pub",
      privateKey: "priv",
      subject: "mailto:owner@example.com",
    });
  });
});

describe("buildVapidJwt", () => {
  it("signs an ES256 JWT with the audience and subject claims", async () => {
    const { config, verifyKey } = await makeVapidKeys();
    const jwt = await buildVapidJwt({
      config,
      audience: "https://push.example.com",
      nowSeconds: 1_700_000_000,
    });
    const [header, payload, signature] = jwt.split(".");
    expect(header).toBeDefined();
    expect(payload).toBeDefined();
    expect(signature).toBeDefined();

    const decoded = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload as string))) as {
      aud: string;
      sub: string;
      exp: number;
    };
    expect(decoded.aud).toBe("https://push.example.com");
    expect(decoded.sub).toBe(config.subject);
    expect(decoded.exp).toBe(1_700_000_000 + 12 * 60 * 60);

    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verifyKey,
      base64UrlToBytes(signature as string),
      new TextEncoder().encode(`${header}.${payload}`),
    );
    expect(valid).toBe(true);
  });
});

describe("sendWebPush", () => {
  it("posts an empty-body VAPID request", async () => {
    const { config } = await makeVapidKeys();
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response("", { status: 201 });
    }) as typeof fetch;

    const result = await sendWebPush(SUBSCRIPTION, config, {
      fetch: fakeFetch,
      now: () => 1_700_000_000_000,
    });
    expect(result).toEqual({ ok: true, status: 201, gone: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(SUBSCRIPTION.endpoint);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.TTL).toBe("2419200");
    expect(headers.Authorization).toContain(`vapid t=`);
    expect(headers.Authorization).toContain(`, k=${config.publicKey}`);
  });

  it("flags an expired subscription as gone", async () => {
    const { config } = await makeVapidKeys();
    const fakeFetch = (async () => new Response("", { status: 410 })) as typeof fetch;
    const result = await sendWebPush(SUBSCRIPTION, config, { fetch: fakeFetch });
    expect(result).toEqual({ ok: false, status: 410, gone: true });
  });
});
