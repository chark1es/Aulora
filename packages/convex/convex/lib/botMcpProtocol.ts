import type { BotMcpScope } from "@aulora/core";
import { findTool, toolsForScope } from "./botMcpTools";
import { AULORA_VERSION } from "./env";

/**
 * Pure JSON-RPC 2.0 / MCP dispatch for the stateless Streamable HTTP endpoint.
 * No Convex, no HTTP: `botMcpHttp.ts` does the transport and authentication,
 * then hands a parsed body and a tool runner to {@link handleMcpMessage}.
 */

export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const MCP_FALLBACK_VERSION = "2025-06-18";

export const RPC_ERROR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
} as const;

export const MCP_INSTRUCTIONS = [
  "Aulora bots are small programs written in TypeScript or Python that act like workspace members.",
  "Each bot is a set of source files stored in Aulora and run by a sandboxed bot runner. The entry file is main.ts (TypeScript, SDK @aulora/bot) or main.py (Python, SDK aulora_bot).",
  'Both SDKs share one shape: create a Bot, register handlers with bot.on("ready" | "message" | "messageUpdate" | "messageDelete" | "reactionAdd" | "reactionRemove" | "error"), call bot.start(), and use bot.messages.send/list/edit/delete, bot.reactions.add/remove, bot.channels.list, bot.members.list and bot.call("module:function", args) for anything else. The runner injects AULORA_TOKEN, AULORA_SITE_URL and the bot\'s own environment variables.',
  "A newly created bot starts disabled and holds no permissions, so it cannot read or send anything yet. Permissions, channel scope and bot API tokens are granted only in the Aulora web UI (Workspace settings, Bots); this server cannot change them.",
  "Typical flow: list_bots, create_bot or get_bot, write_files to edit the code, set_env for secrets (values are write-only), update_bot with enabled true once an admin has granted permissions, then read_logs to check it runs.",
].join("\n\n");

export type RpcId = string | number;

export interface RpcOutcome {
  /** HTTP status to send. */
  readonly status: number;
  /** JSON body, or `null` for an empty body (notifications get 202). */
  readonly body: unknown;
}

export interface ToolCallOutcome {
  readonly isError: boolean;
  readonly text: string;
  readonly structured?: Record<string, unknown>;
}

export interface McpDeps {
  readonly scope: BotMcpScope;
  readonly callTool: (name: string, args: unknown) => Promise<ToolCallOutcome>;
}

function rpcResult(id: RpcId, result: unknown): RpcOutcome {
  return { status: 200, body: { jsonrpc: "2.0", id, result } };
}

/** A JSON-RPC error body. `id` is `null` when the request id is unknown. */
export function rpcError(
  id: RpcId | null,
  code: number,
  message: string,
  status = 200,
): RpcOutcome {
  return { status, body: { jsonrpc: "2.0", id, error: { code, message } } };
}

export function negotiateVersion(requested: unknown): string {
  const match = MCP_PROTOCOL_VERSIONS.find((version) => version === requested);
  return match ?? MCP_FALLBACK_VERSION;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRpcId(value: unknown): value is RpcId {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function handleInitialize(id: RpcId, params: unknown): RpcOutcome {
  if (!isRecord(params) || typeof params.protocolVersion !== "string") {
    return rpcError(id, RPC_ERROR.invalidParams, "initialize requires a protocolVersion");
  }
  return rpcResult(id, {
    protocolVersion: negotiateVersion(params.protocolVersion),
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "aulora-bots", version: AULORA_VERSION },
    instructions: MCP_INSTRUCTIONS,
  });
}

async function handleToolCall(id: RpcId, params: unknown, deps: McpDeps): Promise<RpcOutcome> {
  if (!isRecord(params) || typeof params.name !== "string") {
    return rpcError(id, RPC_ERROR.invalidParams, "tools/call requires a tool name");
  }
  if (params.arguments !== undefined && !isRecord(params.arguments)) {
    return rpcError(id, RPC_ERROR.invalidParams, "Tool arguments must be an object");
  }
  // Unknown tools and tools above the token's scope are indistinguishable.
  if (findTool(deps.scope, params.name) === undefined) {
    return rpcError(id, RPC_ERROR.invalidParams, `Unknown tool: ${params.name}`);
  }
  const outcome = await deps.callTool(params.name, params.arguments ?? {});
  return rpcResult(id, {
    content: [{ type: "text", text: outcome.text }],
    ...(outcome.structured !== undefined ? { structuredContent: outcome.structured } : {}),
    ...(outcome.isError ? { isError: true } : {}),
  });
}

function handleToolsList(id: RpcId, deps: McpDeps): RpcOutcome {
  return rpcResult(id, {
    tools: toolsForScope(deps.scope).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    })),
  });
}

/** Dispatches one JSON-RPC message (never a batch) and returns the HTTP outcome. */
export async function handleMcpMessage(message: unknown, deps: McpDeps): Promise<RpcOutcome> {
  if (Array.isArray(message)) {
    return rpcError(null, RPC_ERROR.invalidRequest, "Batch requests are not supported", 400);
  }
  if (!isRecord(message) || message.jsonrpc !== "2.0") {
    return rpcError(null, RPC_ERROR.invalidRequest, "Expected a JSON-RPC 2.0 message", 400);
  }
  if (typeof message.method !== "string") {
    // A response to a server request (this server sends none) is accepted and dropped.
    const isResponse = "result" in message || "error" in message;
    return isResponse
      ? { status: 202, body: null }
      : rpcError(null, RPC_ERROR.invalidRequest, "Missing method", 400);
  }
  if (!("id" in message)) {
    return { status: 202, body: null };
  }
  const id = message.id;
  if (!isRpcId(id)) {
    return rpcError(null, RPC_ERROR.invalidRequest, "Request ids must be strings or numbers", 400);
  }
  switch (message.method) {
    case "initialize":
      return handleInitialize(id, message.params);
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return handleToolsList(id, deps);
    case "tools/call":
      return await handleToolCall(id, message.params, deps);
    default:
      return rpcError(id, RPC_ERROR.methodNotFound, "Method not found");
  }
}
