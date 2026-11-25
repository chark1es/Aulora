import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { seedWorkspace, type Test } from "./helpers";

export const asOwner = (t: Test) => t.withIdentity({ subject: "owner-1" });

/** A workspace with an owner and a `manager-1` who holds ManageBots through a role. */
export async function seedMcpWorkspace(t: Test, extraMembers: string[] = []) {
  await seedWorkspace(t, {
    extraRoles: [{ key: "botadmin", permissions: Permission.ManageBots, position: 5 }],
    members: [
      { userId: "manager-1", roleIds: [EVERYONE_ROLE_ID, "botadmin"] },
      { userId: "plain-1" },
      ...extraMembers.map((userId) => ({ userId })),
    ],
  });
}

export interface IssueOptions {
  readonly by?: string;
  readonly scope?: "read" | "write";
  readonly botIds?: Id<"bots">[] | null;
  readonly days?: number;
  readonly name?: string;
}

/** Issues a token through the public API and returns the plaintext once. */
export async function issueToken(t: Test, options: IssueOptions = {}) {
  const result = await t
    .withIdentity({ subject: options.by ?? "owner-1" })
    .mutation(api.botMcpTokens.create, {
      name: options.name ?? "Claude Code",
      scope: options.scope ?? "write",
      botIds: options.botIds ?? null,
      expiresInDays: options.days ?? 30,
    });
  return result;
}

export function post(
  t: Test,
  token: string | null,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return t.fetch("/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export interface ToolReply {
  readonly isError: boolean;
  readonly text: string;
  readonly data: Record<string, unknown>;
}

let nextId = 1;

export async function rpc(t: Test, token: string, method: string, params?: unknown) {
  const response = await post(t, token, {
    jsonrpc: "2.0",
    id: nextId++,
    method,
    ...(params !== undefined ? { params } : {}),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

export async function callTool(
  t: Test,
  token: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolReply> {
  const { body } = await rpc(t, token, "tools/call", { name, arguments: args });
  const result = body.result as {
    isError?: boolean;
    content: { text: string }[];
    structuredContent?: Record<string, unknown>;
  };
  return {
    isError: result.isError === true,
    text: result.content[0]?.text ?? "",
    data: result.structuredContent ?? {},
  };
}

/** Creates a bot as the owner through the public UI mutation. */
export async function createBot(t: Test, name: string): Promise<Id<"bots">> {
  const created = await asOwner(t).mutation(api.bots.create, {
    name,
    language: "typescript",
    template: "hello",
  });
  return created.botId as Id<"bots">;
}

export async function readAudit(t: Test) {
  return await t.run(async (ctx) => await ctx.db.query("auditLog").collect());
}
