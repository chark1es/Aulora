/**
 * Aulora push relay.
 *
 * A tiny, dependency-free HTTP service that holds provider credentials for the
 * official mobile builds and forwards content-free wakeups. It is the one
 * outside dependency of an otherwise fully self-hosted Aulora: Apple and
 * Google only deliver push through APNs and FCM.
 *
 * Contract (POST /v1/wake):
 *   Authorization: Bearer <PUSH_RELAY_TOKEN>
 *   {
 *     "v": 1,
 *     "serverId": "<opaque>",
 *     "channelId": "<opaque>",
 *     "messageId": "<opaque>",
 *     "platform": "ios" | "android" | "unifiedpush",
 *     "token": "<APNs/FCM token, or UnifiedPush endpoint URL>"
 *   }
 * Response: 202 {"accepted": true, "provider": "<name>"} on delivery;
 *   provider failures return 502, and no message content is ever accepted.
 */

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { loadRelayConfig } from "./config.mjs";
import {
  bearerMatches,
  createProviderRegistry,
  RelayError,
  validateWake,
} from "./providers.mjs";

const MAX_BODY_BYTES = 8 * 1024;
const WAKE_PATH = "/v1/wake";

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function readBody(request, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new RelayError("payload-too-large", "request body is too large", 413));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

/**
 * Creates the relay's HTTP server. `providers` maps a platform to a provider
 * with an async `deliver(wake)`; inject a fake for tests.
 */
export function createRelayServer({ token, providers = {}, maxBodyBytes = MAX_BODY_BYTES } = {}) {
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("relay token is required");
  }
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname !== WAKE_PATH) {
        sendJson(response, 404, { error: "not-found" });
        return;
      }
      if (request.method !== "POST") {
        response.setHeader("allow", "POST");
        sendJson(response, 405, { error: "method-not-allowed" });
        return;
      }
      if (!bearerMatches(request.headers.authorization, token)) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
      const raw = await readBody(request, maxBodyBytes);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        sendJson(response, 400, { error: "bad-request", message: "body is not JSON" });
        return;
      }
      const wake = validateWake(parsed);
      const provider = providers[wake.platform];
      if (!provider) {
        sendJson(response, 503, { error: "provider-unavailable", platform: wake.platform });
        return;
      }
      const result = await provider.deliver(wake);
      if (!result?.ok) {
        sendJson(response, 502, { error: "delivery-failed", status: result?.status ?? 0 });
        return;
      }
      sendJson(response, 202, { accepted: true, provider: provider.name });
    } catch (error) {
      if (error instanceof RelayError) {
        sendJson(response, error.status, { error: error.code, message: error.message });
        return;
      }
      sendJson(response, 500, { error: "internal" });
    }
  });
}

/** Starts the relay from environment configuration. */
export function startRelayServer(env = process.env) {
  const config = loadRelayConfig(env);
  const providers = createProviderRegistry(config.providers);
  const server = createRelayServer({ token: config.token, providers });
  server.listen(config.port);
  return server;
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  startRelayServer();
}
