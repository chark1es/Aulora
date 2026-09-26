import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { loadRelayConfig } from "../src/config.mjs";
import {
  bearerMatches,
  buildApnsJwt,
  createProviderRegistry,
  createUnifiedPushProvider,
  RelayError,
  validateWake,
} from "../src/providers.mjs";
import { createRelayServer } from "../src/server.mjs";

const VALID_WAKE = {
  serverId: "srv-1",
  channelId: "chan-1",
  messageId: "msg-1",
  platform: "ios",
  token: "apns-token",
};

async function withServer(relay, run) {
  const server = createRelayServer(relay);
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function fakeProvider() {
  const delivered = [];
  return {
    delivered,
    provider: {
      name: "fake",
      async deliver(wake) {
        delivered.push(wake);
        return { ok: true, status: 202 };
      },
    },
  };
}

test("validateWake accepts only opaque id fields", () => {
  assert.deepEqual(validateWake({ ...VALID_WAKE, v: 1 }), VALID_WAKE);
  assert.throws(() => validateWake({ ...VALID_WAKE, platform: "desktop" }), RelayError);
  assert.throws(() => validateWake({ ...VALID_WAKE, token: "" }), RelayError);
  assert.throws(() => validateWake({ ...VALID_WAKE, body: "message text" }), /unexpected field/);
  assert.throws(() => validateWake(null), RelayError);
});

test("bearerMatches is exact and timing safe", () => {
  assert.equal(bearerMatches("Bearer secret", "secret"), true);
  assert.equal(bearerMatches("Bearer secrets", "secret"), false);
  assert.equal(bearerMatches("Basic secret", "secret"), false);
  assert.equal(bearerMatches(undefined, "secret"), false);
});

test("accepts a valid wake and forwards only opaque ids", async () => {
  const { delivered, provider } = fakeProvider();
  await withServer({ token: "secret", providers: { ios: provider } }, async (base) => {
    const response = await fetch(`${base}/v1/wake`, {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify(VALID_WAKE),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { accepted: true, provider: "fake" });
  });
  assert.equal(delivered.length, 1);
  assert.deepEqual(Object.keys(delivered[0]).sort(), [
    "channelId",
    "messageId",
    "platform",
    "serverId",
    "token",
  ]);
  assert.equal(delivered[0].messageId, "msg-1");
});

test("rejects bad auth, method, path, json, and missing providers", async () => {
  await withServer({ token: "secret", providers: { ios: fakeProvider().provider } }, async (base) => {
    const unauthorized = await fetch(`${base}/v1/wake`, { method: "POST", body: "{}" });
    assert.equal(unauthorized.status, 401);

    const notFound = await fetch(`${base}/nope`, {
      headers: { authorization: "Bearer secret" },
    });
    assert.equal(notFound.status, 404);

    const wrongMethod = await fetch(`${base}/v1/wake`, {
      headers: { authorization: "Bearer secret" },
    });
    assert.equal(wrongMethod.status, 405);

    const badJson = await fetch(`${base}/v1/wake`, {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: "not json",
    });
    assert.equal(badJson.status, 400);

    const noProvider = await fetch(`${base}/v1/wake`, {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: JSON.stringify({ ...VALID_WAKE, platform: "unifiedpush" }),
    });
    assert.equal(noProvider.status, 503);
  });
});

test("returns 502 when a provider rejects delivery", async () => {
  const provider = { name: "fake", async deliver() { return { ok: false, status: 410 }; } };
  await withServer({ token: "t", providers: { ios: provider } }, async (base) => {
    const response = await fetch(`${base}/v1/wake`, {
      method: "POST",
      headers: { authorization: "Bearer t" },
      body: JSON.stringify(VALID_WAKE),
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "delivery-failed", status: 410 });
  });
});

test("unifiedpush provider posts content-free ids to the device endpoint", async () => {
  const calls = [];
  const provider = createUnifiedPushProvider({
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response("", { status: 202 });
    },
  });
  const result = await provider.deliver({
    ...VALID_WAKE,
    platform: "unifiedpush",
    token: "https://push.example.com/device/abc",
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, "https://push.example.com/device/abc");
  assert.deepEqual(calls[0].body, {
    serverId: "srv-1",
    channelId: "chan-1",
    messageId: "msg-1",
  });
  assert.equal(JSON.stringify(calls[0].body).includes("text"), false);
});

test("builds a verifiable ES256 APNs provider token", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const jwt = buildApnsJwt({
    keyId: "key-id",
    teamId: "team-id",
    key: pem,
    nowSeconds: 1_700_000_000,
  });
  const [header, claims, signature] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), {
    alg: "ES256",
    kid: "key-id",
  });
  assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url").toString()), {
    iss: "team-id",
    iat: 1_700_000_000,
  });
  const verifier = createVerify("SHA256");
  verifier.update(`${header}.${claims}`);
  verifier.end();
  assert.equal(
    verifier.verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")),
    true,
  );
});

test("loadRelayConfig enables only fully configured providers", () => {
  assert.throws(() => loadRelayConfig({}), /PUSH_RELAY_TOKEN/);
  const config = loadRelayConfig({
    PUSH_RELAY_TOKEN: "secret",
    PUSH_RELAY_PORT: "9000",
    APNS_KEY_ID: "kid",
    APNS_TEAM_ID: "team",
    APNS_TOPIC: "app.aulora.ios",
    APNS_KEY_PATH: "/keys/apns.p8",
    FCM_PROJECT_ID: "proj",
    FCM_ACCESS_TOKEN: "fcm-token",
    UNIFIEDPUSH_ENABLED: "1",
  }, { readFile: () => "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----" });
  assert.equal(config.token, "secret");
  assert.equal(config.port, 9000);
  const registry = createProviderRegistry(config.providers);
  assert.equal(registry.ios.name, "apns");
  assert.equal(registry.android.name, "fcm");
  assert.equal(registry.unifiedpush.name, "unifiedpush");
});
