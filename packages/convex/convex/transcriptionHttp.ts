import type { HttpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, httpAction } from "./_generated/server";

/**
 * Transcriber → Convex ingest routes under `/transcription/*`.
 *
 * Authenticated with `TRANSCRIBER_TOKEN` exactly like the bot-runner API: both
 * values are SHA-256 hashed and compared byte-for-byte, so no branch or log
 * compares secret strings. Every response is `no-store`.
 */

const BEARER_PREFIX = "Bearer ";
const MAX_BODY_BYTES = 256 * 1024;
const MAX_SEGMENTS = 50;
const MAX_TEXT_CHARS = 8_000;
const STATUSES = new Set<string>(["not_installed", "downloading", "ready", "error"]);

type JsonObject = Record<string, unknown>;

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
    difference |= (left.at(index) ?? 0) ^ (right.at(index) ?? 0);
  }
  return difference === 0;
}

async function authorize(request: Request): Promise<Response | null> {
  const configured = process.env.TRANSCRIBER_TOKEN;
  if (configured === undefined || configured.length === 0) {
    return json({ error: "transcription_unavailable" }, 503);
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
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length <= 0 || length > MAX_BODY_BYTES) {
      return null;
    }
  }
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

interface ParsedSegment {
  readonly seq: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly confidence?: number;
  readonly language?: string;
}

function readSegments(value: unknown): ParsedSegment[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SEGMENTS) {
    return null;
  }
  const segments: ParsedSegment[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return null;
    }
    const record = entry as JsonObject;
    if (
      typeof record.seq !== "number" ||
      typeof record.startMs !== "number" ||
      typeof record.endMs !== "number" ||
      typeof record.text !== "string" ||
      record.text.length > MAX_TEXT_CHARS
    ) {
      return null;
    }
    if (
      record.confidence !== undefined &&
      record.confidence !== null &&
      (typeof record.confidence !== "number" || !Number.isFinite(record.confidence))
    ) {
      return null;
    }
    if (
      record.language !== undefined &&
      record.language !== null &&
      (typeof record.language !== "string" || record.language.length > 20)
    ) {
      return null;
    }
    segments.push({
      seq: record.seq,
      startMs: record.startMs,
      endMs: record.endMs,
      text: record.text,
      ...(typeof record.confidence === "number" ? { confidence: record.confidence } : {}),
      ...(typeof record.language === "string" ? { language: record.language } : {}),
    });
  }
  return segments;
}

async function handleIngest(ctx: ActionCtx, request: Request): Promise<Response> {
  const denied = await authorize(request);
  if (denied !== null) {
    return denied;
  }
  const body = await readBody(request);
  if (body === null) {
    return json({ error: "invalid_body" }, 400);
  }
  const sessionId = body.sessionId;
  const speakerKey = body.speakerKey;
  const segments = readSegments(body.segments);
  if (
    typeof sessionId !== "string" ||
    sessionId.length === 0 ||
    sessionId.length > 64 ||
    typeof speakerKey !== "string" ||
    speakerKey.length === 0 ||
    speakerKey.length > 80 ||
    segments === null
  ) {
    return json({ error: "invalid_body" }, 400);
  }
  try {
    const result = await ctx.runMutation(internal.transcription.ingestSegments, {
      sessionId: sessionId as Id<"transcriptionSessions">,
      speakerKey,
      segments,
    });
    return json({ ok: true, accepted: result.accepted }, 200);
  } catch {
    // A stale session or a non-participant speaker is not a secret: return a
    // generic rejection so the transcriber can drop the batch.
    return json({ error: "rejected" }, 400);
  }
}

async function handleModelStatus(ctx: ActionCtx, request: Request): Promise<Response> {
  const denied = await authorize(request);
  if (denied !== null) {
    return denied;
  }
  const body = await readBody(request);
  if (body === null) {
    return json({ error: "invalid_body" }, 400);
  }
  const modelId = body.modelId;
  const status = body.status;
  const progress = body.progress;
  const error = body.error;
  if (
    typeof modelId !== "string" ||
    modelId.length > 40 ||
    typeof status !== "string" ||
    !STATUSES.has(status)
  ) {
    return json({ error: "invalid_body" }, 400);
  }
  if (
    progress !== undefined &&
    progress !== null &&
    (typeof progress !== "number" || !Number.isFinite(progress))
  ) {
    return json({ error: "invalid_body" }, 400);
  }
  if (error !== undefined && error !== null && (typeof error !== "string" || error.length > 300)) {
    return json({ error: "invalid_body" }, 400);
  }
  await ctx.runMutation(internal.transcription.recordModelStatus, {
    modelId,
    status: status as "not_installed" | "downloading" | "ready" | "error",
    ...(typeof progress === "number" ? { progress } : {}),
    ...(typeof error === "string" ? { error } : {}),
  });
  return json({ ok: true }, 200);
}

async function handleHello(ctx: ActionCtx, request: Request): Promise<Response> {
  const denied = await authorize(request);
  if (denied !== null) {
    return denied;
  }
  const body = await readBody(request);
  if (body === null) {
    return json({ error: "invalid_body" }, 400);
  }
  // Presence is recorded first and independently of model fields. A null or
  // malformed optional field is normalised away, never a 400: a cold start
  // (loadedModelId absent) must still mark the service installed.
  const loadedModelId =
    typeof body.loadedModelId === "string" &&
    body.loadedModelId.length > 0 &&
    body.loadedModelId.length <= 40
      ? body.loadedModelId
      : undefined;
  const loadedStatus =
    body.loadedStatus === "ready" || body.loadedStatus === "not_installed"
      ? body.loadedStatus
      : undefined;
  const loadedError =
    typeof body.loadedError === "string" && body.loadedError.length <= 300
      ? body.loadedError
      : undefined;
  const downloadActive =
    body.downloadActive === true ? true : body.downloadActive === false ? false : undefined;
  await ctx.runMutation(internal.transcription.recordServiceHello, {
    ...(loadedModelId !== undefined ? { loadedModelId } : {}),
    ...(loadedStatus !== undefined ? { loadedStatus } : {}),
    ...(loadedError !== undefined ? { loadedError } : {}),
    ...(downloadActive !== undefined ? { downloadActive } : {}),
  });
  return json({ ok: true }, 200);
}

export function registerTranscriptionRoutes(http: HttpRouter): void {
  http.route({
    path: "/transcription/hello",
    method: "POST",
    handler: httpAction(handleHello),
  });
  http.route({
    path: "/transcription/ingest",
    method: "POST",
    handler: httpAction(handleIngest),
  });
  http.route({
    path: "/transcription/model",
    method: "POST",
    handler: httpAction(handleModelStatus),
  });
}
