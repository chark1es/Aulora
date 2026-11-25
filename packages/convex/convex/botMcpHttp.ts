/**
 * `POST /api/mcp`: stateless Streamable HTTP MCP server for managing bots.
 * Responds with `application/json` only (no sessions, no SSE). Authentication
 * is an admin-issued `amt_` bearer token; see `botMcpInternal.ts` and
 * `docs/bots-design.md`. No CORS headers are sent: MCP clients are not browsers.
 */
import { BOT_MCP_MAX_BODY_BYTES, BOT_MCP_PATH, type BotMcpScope } from "@aulora/core";
import type { GenericActionCtx, HttpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { hashBotMcpToken, looksLikeBotMcpToken } from "./lib/botMcpAuth";
import {
  handleMcpMessage,
  RPC_ERROR,
  type RpcOutcome,
  rpcError,
  type ToolCallOutcome,
} from "./lib/botMcpProtocol";
import { findTool } from "./lib/botMcpTools";
import { authSiteOrigin } from "./lib/env";

type ActionCtx = GenericActionCtx<DataModel>;

const BASE_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };

function send(outcome: RpcOutcome, extra: Record<string, string> = {}): Response {
  if (outcome.body === null) {
    return new Response(null, { status: outcome.status, headers: { "cache-control": "no-store" } });
  }
  return new Response(JSON.stringify(outcome.body), {
    status: outcome.status,
    headers: { ...BASE_HEADERS, ...extra },
  });
}

function failure(status: number, message: string, extra: Record<string, string> = {}): Response {
  return send(rpcError(null, RPC_ERROR.invalidRequest, message, status), extra);
}

function unauthorized(): Response {
  return send(rpcError(null, -32001, "Unauthorized", 401), {
    "www-authenticate": 'Bearer realm="aulora-mcp"',
  });
}

/** The secret in `Authorization: Bearer <secret>`, or `null` when absent or malformed. */
function readBearer(header: string | null): string | null {
  const match = /^Bearer +(\S+)$/i.exec(header?.trim() ?? "");
  const candidate = match?.[1] ?? "";
  return looksLikeBotMcpToken(candidate) ? candidate : null;
}

/** DNS-rebinding/CSRF guard: a browser-sent Origin must be the workspace site. */
function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) {
    return true;
  }
  const site = authSiteOrigin(process.env);
  try {
    return site !== null && new URL(origin).origin === new URL(site).origin;
  } catch {
    return false;
  }
}

function isJsonContentType(request: Request): boolean {
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  return type === "application/json";
}

type BodyResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly response: Response };

/** Reads the JSON body, refusing anything over the cap before parsing it. */
async function readJsonBody(request: Request): Promise<BodyResult> {
  const tooLarge = { ok: false as const, response: failure(413, "Request body too large") };
  if (Number(request.headers.get("content-length") ?? "0") > BOT_MCP_MAX_BODY_BYTES) {
    return tooLarge;
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > BOT_MCP_MAX_BODY_BYTES) {
    return tooLarge;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    const parse = rpcError(null, RPC_ERROR.parse, "Parse error", 400);
    return { ok: false, response: send(parse) };
  }
}

interface Authorized {
  readonly tokenHash: string;
  readonly scope: BotMcpScope;
}

/** Steps 1-4 of request authorization; returns a refusal response or the session facts. */
async function authenticate(ctx: ActionCtx, request: Request): Promise<Authorized | Response> {
  const presented = readBearer(request.headers.get("authorization"));
  if (typeof presented !== "string") {
    return unauthorized();
  }
  const tokenHash = await hashBotMcpToken(presented);
  try {
    await ctx.runMutation(internal.botMcpInternal.enforceTokenRateLimit, { tokenHash });
  } catch {
    // The limiter is the only thing that rejects here; fail closed either way.
    return failure(429, "Rate limit exceeded", { "retry-after": "60" });
  }
  const auth = await ctx.runMutation(internal.botMcpInternal.authorize, { tokenHash });
  if (auth.status === "unauthorized") {
    return unauthorized();
  }
  if (auth.status === "forbidden") {
    return failure(403, "The token's creator can no longer manage bots");
  }
  return { tokenHash, scope: auth.scope };
}

/** Runs a tool; failures become `isError` results with a safe message. */
async function callTool(
  ctx: ActionCtx,
  auth: Authorized,
  name: string,
  args: unknown,
): Promise<ToolCallOutcome> {
  const request = { tokenHash: auth.tokenHash, name, argsJson: JSON.stringify(args) };
  try {
    const readOnly = findTool(auth.scope, name)?.annotations.readOnlyHint === true;
    const result = readOnly
      ? await ctx.runQuery(internal.botMcpInternal.readTool, request)
      : await ctx.runMutation(internal.botMcpInternal.writeTool, request);
    return { isError: false, text: JSON.stringify(result), structured: result };
  } catch (error) {
    if (error instanceof ConvexError && typeof error.data === "string") {
      return { isError: true, text: error.data };
    }
    return { isError: true, text: "The tool failed unexpectedly. Try again." };
  }
}

function methodNotAllowed(): Response {
  return failure(405, "Use POST", { allow: "POST" });
}

export function registerBotMcpRoutes(http: HttpRouter): void {
  http.route({
    path: BOT_MCP_PATH,
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      if (!originAllowed(request)) {
        return failure(403, "Origin not allowed");
      }
      if (!isJsonContentType(request)) {
        return failure(415, "Content-Type must be application/json");
      }
      const auth = await authenticate(ctx, request);
      if (auth instanceof Response) {
        return auth;
      }
      const body = await readJsonBody(request);
      if (!body.ok) {
        return body.response;
      }
      const outcome = await handleMcpMessage(body.value, {
        scope: auth.scope,
        callTool: (name, args) => callTool(ctx, auth, name, args),
      });
      return send(outcome);
    }),
  });
  for (const method of ["GET", "DELETE"] as const) {
    http.route({
      path: BOT_MCP_PATH,
      method,
      handler: httpAction(() => Promise.resolve(methodNotAllowed())),
    });
  }
}
