/**
 * Aulora push-relay provider adapters.
 *
 * The relay only ever forwards **content-free wakeups**: an opaque server id,
 * channel id and message id (plus the platform/scheme). It never carries
 * message text, sender names or any other payload. Aulora encrypts content
 * server-side, so the relay cannot read anything it carries; the app fetches
 * and decrypts authorized content from its own server.
 *
 * Each provider takes the validated wake and builds its own provider-specific
 * envelope. Providers are injectable so the contract is unit-tested without
 * real APNs/FCM credentials.
 */

import { createSign, timingSafeEqual } from "node:crypto";

export const MOBILE_PLATFORMS = ["ios", "android", "unifiedpush"];

/** Wake fields, already validated to contain only opaque identifiers. */
export const WAKE_FIELDS = ["serverId", "channelId", "messageId", "platform", "token", "kind"];
const MAX_ID_LENGTH = 512;

export class RelayError extends Error {
  /**
   * @param {string} code machine-readable error code
   * @param {string} message human-readable message (no secrets)
   * @param {number} status HTTP status to return
   */
  constructor(code, message, status) {
    super(message);
    this.name = "RelayError";
    this.code = code;
    this.status = status;
  }
}

/** The ids passed downstream to a provider; deliberately no message text. */
export function contentFreePayload(wake) {
  return {
    serverId: wake.serverId,
    channelId: wake.channelId,
    messageId: wake.messageId,
    kind: wake.kind,
  };
}

function requireId(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw new RelayError("bad-request", `${field} must be a non-empty string`, 400);
  }
  return value;
}

/**
 * Validates a wake request body. Rejects unknown/extra fields so a caller can
 * never smuggle a payload through the relay.
 */
export function validateWake(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new RelayError("bad-request", "body must be a JSON object", 400);
  }
  for (const field of Object.keys(body)) {
    if (field !== "v" && !WAKE_FIELDS.includes(field)) {
      throw new RelayError("bad-request", `unexpected field: ${field}`, 400);
    }
  }
  const platform = body.platform;
  if (typeof platform !== "string" || !MOBILE_PLATFORMS.includes(platform)) {
    throw new RelayError("bad-request", "unsupported platform", 400);
  }
  const kind = body.kind ?? "message";
  if (kind !== "message" && kind !== "call") {
    throw new RelayError("bad-request", "unsupported notification kind", 400);
  }
  const token = requireId(body.token, "token");
  if (platform !== "unifiedpush" && token.length > MAX_ID_LENGTH) {
    throw new RelayError("bad-request", "token is too long", 400);
  }
  return {
    serverId: requireId(body.serverId, "serverId"),
    channelId: requireId(body.channelId, "channelId"),
    messageId: requireId(body.messageId, "messageId"),
    platform,
    token,
    kind,
  };
}

/** Timing-safe bearer-token check. */
export function bearerMatches(header, expected) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return false;
  }
  const provided = Buffer.from(header.slice("Bearer ".length));
  const secret = Buffer.from(expected);
  if (provided.length !== secret.length) {
    return false;
  }
  return timingSafeEqual(provided, secret);
}

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Builds an APNs provider (token-based) JWT. ES256 over header.payload; the
 * signature is converted from DER to the JOSE raw r‖s form.
 */
export function buildApnsJwt({ keyId, teamId, key, nowSeconds = Math.floor(Date.now() / 1000) }) {
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = base64Url(JSON.stringify({ iss: teamId, iat: nowSeconds }));
  const signingInput = `${header}.${claims}`;
  const signer = createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  const der = signer.sign({ key, dsaEncoding: "der" });
  return `${signingInput}.${base64Url(derToJose(der))}`;
}

/** Converts an ECDSA DER signature to the fixed 64-byte JOSE encoding. */
export function derToJose(der) {
  let offset = 0;
  const nextByte = () => {
    const byte = der.at(offset);
    if (byte === undefined) {
      throw new RelayError("provider-error", "malformed ECDSA signature", 500);
    }
    return byte;
  };
  if (nextByte() !== 0x30) {
    throw new RelayError("provider-error", "malformed ECDSA signature", 500);
  }
  offset += 1;
  if (nextByte() === 0x81) {
    offset += 2;
  } else {
    offset += 1;
  }
  const readInt = () => {
    if (nextByte() !== 0x02) {
      throw new RelayError("provider-error", "malformed ECDSA signature", 500);
    }
    offset += 1;
    const length = nextByte();
    offset += 1;
    let value = der.subarray(offset, offset + length);
    offset += length;
    while (value.length > 32 && value.at(0) === 0) {
      value = value.subarray(1);
    }
    const padded = Buffer.alloc(32);
    value.copy(padded, 32 - value.length);
    return padded;
  };
  const r = readInt();
  const s = readInt();
  return Buffer.concat([r, s]);
}

const APNS_HOSTS = new Map([
  ["production", "https://api.push.apple.com"],
  ["sandbox", "https://api.sandbox.push.apple.com"],
]);

/**
 * APNs adapter. `request` is injectable (defaults to Node's HTTP/2 client) so
 * the provider can be exercised without contacting Apple.
 */
export function createApnsProvider({
  keyId,
  teamId,
  key,
  topic,
  environment = "production",
  request = defaultApnsRequest,
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  for (const [field, value] of Object.entries({ keyId, teamId, key, topic })) {
    if (typeof value !== "string" || value.length === 0) {
      throw new RelayError("config-error", `APNs ${field} is required`, 500);
    }
  }
  const host = APNS_HOSTS.get(environment) ?? APNS_HOSTS.get("production");
  return {
    name: "apns",
    async deliver(wake) {
      const jwt = buildApnsJwt({ keyId, teamId, key, nowSeconds: now() });
      const body = JSON.stringify({
        aps: {
          alert: wake.kind === "call" ? "Incoming Aulora call" : "New Aulora message",
          sound: wake.kind === "call" ? "default" : undefined,
          "mutable-content": 1,
        },
        aulora: contentFreePayload(wake),
      });
      return await request({
        url: `${host}/3/device/${wake.token}`,
        headers: {
          authorization: `bearer ${jwt}`,
          "apns-topic": topic,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "content-type": "application/json",
        },
        body,
      });
    },
  };
}

async function defaultApnsRequest({ url, headers, body }) {
  const http2 = await import("node:http2");
  return await new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = http2.connect(target.origin);
    const request = client.request({
      ":method": "POST",
      ":path": target.pathname,
      ...headers,
    });
    let status = 0;
    request.on("response", (responseHeaders) => {
      status = Number(responseHeaders[":status"] ?? 0);
    });
    request.on("error", reject);
    request.on("close", () => {
      client.close();
      resolve({ ok: status >= 200 && status < 300, status });
    });
    request.end(body);
  });
}

/** FCM HTTP v1 adapter. The OAuth access token is supplied by the operator. */
export function createFcmProvider({
  projectId,
  accessToken,
  serviceAccount,
  fetchImpl = fetch,
  now = () => Date.now(),
} = {}) {
  if (typeof projectId !== "string" || projectId.length === 0) {
    throw new RelayError("config-error", "FCM projectId is required", 500);
  }
  if (
    !accessToken &&
    (typeof serviceAccount?.client_email !== "string" ||
      typeof serviceAccount?.private_key !== "string")
  ) {
    throw new RelayError("config-error", "FCM access token or service account is required", 500);
  }
  let cachedToken;
  let tokenExpiresAt = 0;
  async function bearerToken() {
    if (cachedToken && now() < tokenExpiresAt - 60_000) return cachedToken;
    if (accessToken) return accessToken;
    const issuedAt = Math.floor(now() / 1000);
    const jwtHeader = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const jwtClaims = base64Url(
      JSON.stringify({
        iss: serviceAccount.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: issuedAt,
        exp: issuedAt + 3600,
      }),
    );
    const input = `${jwtHeader}.${jwtClaims}`;
    const signer = createSign("RSA-SHA256");
    signer.update(input);
    signer.end();
    const assertion = `${input}.${base64Url(signer.sign(serviceAccount.private_key))}`;
    const response = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!response.ok) throw new RelayError("provider-error", "FCM token request failed", 502);
    const data = await response.json();
    if (typeof data.access_token !== "string" || typeof data.expires_in !== "number") {
      throw new RelayError("provider-error", "FCM token response is invalid", 502);
    }
    cachedToken = data.access_token;
    tokenExpiresAt = now() + data.expires_in * 1000;
    return cachedToken;
  }
  return {
    name: "fcm",
    async deliver(wake) {
      const token = await bearerToken();
      const response = await fetchImpl(
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: wake.token,
              data: contentFreePayload(wake),
              notification: {
                title: "Aulora",
                body: wake.kind === "call" ? "Incoming call" : "New message",
              },
              android: {
                priority: wake.kind === "call" ? "high" : "normal",
                notification: { channel_id: wake.kind === "call" ? "calls" : "default" },
              },
            },
          }),
        },
      );
      return { ok: response.ok, status: response.status };
    },
  };
}

/**
 * UnifiedPush adapter: the "token" is the device's own push endpoint URL. Fully
 * self-hosted, no Google or Apple in the path.
 */
export function createUnifiedPushProvider({ fetchImpl = fetch } = {}) {
  return {
    name: "unifiedpush",
    async deliver(wake) {
      let endpoint;
      try {
        endpoint = new URL(wake.token);
      } catch {
        throw new RelayError("bad-request", "unifiedpush token must be a URL", 400);
      }
      if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
        throw new RelayError("bad-request", "unifiedpush endpoint must be http(s)", 400);
      }
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(contentFreePayload(wake)),
      });
      return { ok: response.ok, status: response.status };
    },
  };
}

/** Builds the platform→provider registry from configuration. */
export function createProviderRegistry(config = {}) {
  const providers = {};
  if (config.apns) {
    providers.ios = createApnsProvider(config.apns);
  }
  if (config.fcm) {
    providers.android = createFcmProvider(config.fcm);
  }
  if (config.unifiedpush !== undefined) {
    providers.unifiedpush = createUnifiedPushProvider(config.unifiedpush);
  }
  return providers;
}
