/**
 * Runner endpoints under `/bots/runner/*`, authenticated with `BOT_RUNNER_TOKEN`.
 * See `docs/bots-design.md`.
 *
 * The bearer value and the configured secret are SHA-256 hashed and compared
 * byte-for-byte, so no branch or log ever compares secret strings directly.
 * Bodies are validated strictly and every response is `no-store`.
 */
import type { HttpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, httpAction } from "./_generated/server";
import type { BotStatus } from "./lib/botTypes";

const BEARER_PREFIX = "Bearer ";
const MAX_ID_LENGTH = 64;
const MAX_LOG_LINES = 200;
const MAX_STATUS_MESSAGE = 2000;
const RUNNER_STATUSES = new Set<string>(["starting", "running", "stopped", "crashed"]);
const STREAMS = new Set<string>(["stdout", "stderr", "system"]);

type JsonObject = Record<string, unknown>;

interface ParsedLogLine {
  readonly stream: "stdout" | "stderr" | "system";
  readonly text: string;
  readonly at: number;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

/** Constant-time byte compare; both inputs are 32-byte digests. */
function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/** `503` when unconfigured, `401` when the bearer value is wrong, else null. */
async function authorize(request: Request): Promise<Response | null> {
  const configured = process.env.BOT_RUNNER_TOKEN;
  if (configured === undefined || configured.length === 0) {
    return json({ error: "bots_unavailable" }, 503);
  }
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : "";
  const [expected, actual] = await Promise.all([sha256(configured), sha256(provided)]);
  if (!equalBytes(expected, actual)) {
    return json({ error: "unauthorized" }, 401);
  }
  return null;
}

async function readBody(request: Request): Promise<JsonObject | null> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  return parsed as JsonObject;
}

function readBotId(body: JsonObject): Id<"bots"> | null {
  const value = body.botId;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) {
    return null;
  }
  return value as Id<"bots">;
}

async function handleDesired(ctx: ActionCtx, request: Request): Promise<Response> {
  const denied = await authorize(request);
  if (denied !== null) {
    return denied;
  }
  const bots = await ctx.runMutation(internal.botRuntime.desired, {});
  return json({ bots }, 200);
}

async function handleBundle(ctx: ActionCtx, request: Request): Promise<Response> {
  const denied = await authorize(request);
  if (denied !== null) {
    return denied;
  }
  const botId = new URL(request.url).searchParams.get("botId");
  if (botId === null || botId.length === 0 || botId.length > MAX_ID_LENGTH) {
    return json({ error: "invalid_bot" }, 400);
  }
  try {
    const bundle = await ctx.runQuery(internal.botRuntime.bundle, { botId: botId as Id<"bots"> });
    if (bundle === null) {
      return json({ error: "not_found" }, 404);
    }
    return json(bundle, 200);
  } catch {
    return json({ error: "invalid_bot" }, 400);
  }
}

async function handleCredential(ctx: ActionCtx, request: Request): Promise<Response> {
  const denied = await authorize(request);
  if (denied !== null) {
    return denied;
  }
  const body = await readBody(request);
  if (body === null) {
    return json({ error: "invalid_body" }, 400);
  }
  const botId = readBotId(body);
  if (botId === null) {
    return json({ error: "invalid_body" }, 400);
  }
  try {
    const result = await ctx.runMutation(internal.botRuntime.credential, { botId });
    if (result === null) {
      return json({ error: "not_found" }, 404);
    }
    return json(result, 200);
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
}

async function handleReport(ctx: ActionCtx, request: Request): Promise<Response> {
  const denied = await authorize(request);
  if (denied !== null) {
    return denied;
  }
  const body = await readBody(request);
  if (body === null) {
    return json({ error: "invalid_body" }, 400);
  }
  const botId = readBotId(body);
  const reportStatus = body.status;
  if (botId === null || typeof reportStatus !== "string" || !RUNNER_STATUSES.has(reportStatus)) {
    return json({ error: "invalid_body" }, 400);
  }
  const message = body.message;
  if (
    message !== undefined &&
    (typeof message !== "string" || message.length > MAX_STATUS_MESSAGE)
  ) {
    return json({ error: "invalid_body" }, 400);
  }
  const found = await ctx.runMutation(internal.botRuntime.report, {
    botId,
    status: reportStatus as BotStatus,
    ...(typeof message === "string" ? { message } : {}),
  });
  if (!found) {
    return json({ error: "not_found" }, 404);
  }
  return json({ ok: true }, 200);
}

function readLogLines(value: unknown): ParsedLogLine[] | null {
  if (!Array.isArray(value) || value.length > MAX_LOG_LINES) {
    return null;
  }
  const lines: ParsedLogLine[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return null;
    }
    const record = entry as JsonObject;
    if (
      typeof record.stream !== "string" ||
      !STREAMS.has(record.stream) ||
      typeof record.text !== "string" ||
      typeof record.at !== "number" ||
      !Number.isFinite(record.at)
    ) {
      return null;
    }
    lines.push({
      stream: record.stream as ParsedLogLine["stream"],
      text: record.text,
      at: record.at,
    });
  }
  return lines;
}

async function handleLogs(ctx: ActionCtx, request: Request): Promise<Response> {
  const denied = await authorize(request);
  if (denied !== null) {
    return denied;
  }
  const body = await readBody(request);
  if (body === null) {
    return json({ error: "invalid_body" }, 400);
  }
  const botId = readBotId(body);
  const lines = readLogLines(body.lines);
  if (botId === null || lines === null) {
    return json({ error: "invalid_body" }, 400);
  }
  const found = await ctx.runMutation(internal.botRuntime.appendLogs, { botId, lines });
  if (!found) {
    return json({ error: "not_found" }, 404);
  }
  return json({ ok: true }, 200);
}

export function registerRunnerRoutes(http: HttpRouter): void {
  http.route({ path: "/bots/runner/desired", method: "GET", handler: httpAction(handleDesired) });
  http.route({ path: "/bots/runner/bundle", method: "GET", handler: httpAction(handleBundle) });
  http.route({
    path: "/bots/runner/credential",
    method: "POST",
    handler: httpAction(handleCredential),
  });
  http.route({ path: "/bots/runner/report", method: "POST", handler: httpAction(handleReport) });
  http.route({ path: "/bots/runner/logs", method: "POST", handler: httpAction(handleLogs) });
}
