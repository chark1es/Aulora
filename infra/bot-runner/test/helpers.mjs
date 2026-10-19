// Test helpers: a fake Convex runner API and small conveniences.
//
// The fake implements the five runner routes and authenticates the bearer
// token timing-safely, mirroring infra/push-relay/src/providers.mjs.

import { timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";

export const RUNNER_SECRET = "runner-secret-must-not-reach-any-bot";
export const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1"];

/** Timing-safe bearer-token check. */
export function bearerMatches(header, expected) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice("Bearer ".length));
  const secret = Buffer.from(expected);
  if (provided.length !== secret.length) return false;
  return timingSafeEqual(provided, secret);
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function desiredResponse(state) {
  state.desiredCalls += 1;
  return [200, { bots: state.desired }];
}

function bundleResponse(url, state) {
  const bundle = state.bundles.get(url.searchParams.get("botId"));
  return bundle === undefined ? [404, { error: "not_found" }] : [200, bundle];
}

function credentialResponse(body, state) {
  const botId = body?.botId;
  const seq = (state.credentialCalls.get(botId) ?? 0) + 1;
  state.credentialCalls.set(botId, seq);
  const issued = `abt_${botId}_${seq}`;
  state.credentials.set(botId, issued);
  return [200, { token: issued }];
}

function reportResponse(body, state) {
  state.reports.push(body);
  return [200, { ok: true }];
}

function logsResponse(body, state) {
  state.logBatches.push(body);
  for (const line of body?.lines ?? []) state.lines.push({ botId: body.botId, ...line });
  return [200, { ok: true }];
}

function notFound() {
  return [404, { error: "not_found" }];
}

function route(url, body, state) {
  switch (url.pathname) {
    case "/bots/runner/desired":
      return desiredResponse(state);
    case "/bots/runner/bundle":
      return bundleResponse(url, state);
    case "/bots/runner/credential":
      return credentialResponse(body, state);
    case "/bots/runner/report":
      return reportResponse(body, state);
    case "/bots/runner/logs":
      return logsResponse(body, state);
    default:
      return notFound();
  }
}

export async function createFakeConvex() {
  const state = {
    desired: [],
    desiredCalls: 0,
    bundles: new Map(),
    credentials: new Map(),
    credentialCalls: new Map(),
    reports: [],
    logBatches: [],
    lines: [],
    unauthorized: 0,
    runnerSecret: RUNNER_SECRET,
  };

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (!bearerMatches(request.headers.authorization, state.runnerSecret)) {
        state.unauthorized += 1;
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
      const body = await readJson(request);
      const [status, payload] = route(url, body, state);
      sendJson(response, status, payload);
    } catch {
      sendJson(response, 500, { error: "internal" });
    }
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  if (!LOOPBACK_HOSTS.includes(new URL(baseUrl).hostname)) {
    throw new Error(`refusing to bind a non-loopback fake server: ${baseUrl}`);
  }

  return {
    state,
    baseUrl,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

export function desiredBot(botId, overrides = {}) {
  return {
    botId,
    userId: `bot_${botId}`,
    name: "Test Bot",
    language: "typescript",
    entry: "main.mjs",
    revision: 1,
    restartNonce: 0,
    ...overrides,
  };
}

export function bundleFor(botId, files, env = {}, overrides = {}) {
  return {
    botId,
    userId: `bot_${botId}`,
    name: "Test Bot",
    language: "typescript",
    entry: "main.mjs",
    revision: 1,
    files,
    env,
    ...overrides,
  };
}

export function file(path, content) {
  return { path, content };
}

export async function waitFor(
  predicate,
  { timeout = 5000, interval = 10, message = "condition" } = {},
) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${message}`);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
