import { BOT_LIMITS, BOT_MCP_SCOPES, type BotMcpScope } from "@aulora/core";

/**
 * The MCP tool catalog: names, descriptions and JSON Schemas. Deliberately
 * absent (UI-only, so a leaked token cannot escalate a bot): permissions,
 * grants and channel scope, bot API token rotate/revoke, bot deletion and MCP
 * token management. Execution and argument validation live in `botMcpRun.ts`.
 */

export type JsonSchema = Readonly<Record<string, unknown>>;

export interface McpToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: false;
}

export interface McpToolDef {
  readonly name: string;
  readonly description: string;
  readonly scope: BotMcpScope;
  readonly inputSchema: JsonSchema;
  readonly annotations: McpToolAnnotations;
}

const botId = {
  type: "string",
  description: "The bot's id, as returned by list_bots.",
} as const;

function schema(properties: Record<string, unknown>, required: readonly string[]): JsonSchema {
  return { type: "object", properties, required: [...required], additionalProperties: false };
}

const READ_ONLY: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const language = { type: "string", enum: ["typescript", "python"] } as const;

const READ_TOOLS: readonly McpToolDef[] = [
  {
    name: "list_bots",
    description:
      "List the bots this token can see: id, name, description, language, enabled, runtime status, revision, file count and granted permission names.",
    scope: "read",
    inputSchema: schema({}, []),
    annotations: READ_ONLY,
  },
  {
    name: "get_bot",
    description:
      "Show one bot: its summary, files (path and byte size), environment variable names (values are write-only and never returned) and allowed channel ids.",
    scope: "read",
    inputSchema: schema({ botId }, ["botId"]),
    annotations: READ_ONLY,
  },
  {
    name: "read_file",
    description: "Read the full text of one source file of a bot.",
    scope: "read",
    inputSchema: schema(
      { botId, path: { type: "string", description: "Relative path, e.g. main.ts." } },
      ["botId", "path"],
    ),
    annotations: READ_ONLY,
  },
  {
    name: "read_logs",
    description: "Read the newest retained stdout/stderr/system log lines of a bot, oldest first.",
    scope: "read",
    inputSchema: schema(
      {
        botId,
        limit: {
          type: "integer",
          minimum: 1,
          maximum: BOT_LIMITS.maxLogLines,
          description: "How many lines to return (default 100).",
        },
      },
      ["botId"],
    ),
    annotations: READ_ONLY,
  },
  {
    name: "get_runner_status",
    description: "Report whether the bot-runner container is online (polled in the last 30 s).",
    scope: "read",
    inputSchema: schema({}, []),
    annotations: READ_ONLY,
  },
];

const WRITE_TOOLS: readonly McpToolDef[] = [
  {
    name: "create_bot",
    description:
      "Create a bot with starter code. It starts disabled with no permissions; permissions can only be granted in the Aulora web UI. Not available to tokens restricted to specific bots.",
    scope: "write",
    inputSchema: schema(
      {
        name: {
          type: "string",
          minLength: 1,
          maxLength: BOT_LIMITS.maxNameLength,
          description: "Unique bot name.",
        },
        language,
        description: { type: "string", maxLength: BOT_LIMITS.maxDescriptionLength },
        template: {
          type: "string",
          enum: ["hello", "blank"],
          description: "Starter code (default hello).",
        },
      },
      ["name", "language"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "update_bot",
    description:
      "Change a bot's name, description, language or enabled flag. An empty description clears it. Changing language or enabled bumps the revision and the runner reloads the bot.",
    scope: "write",
    inputSchema: schema(
      {
        botId,
        name: { type: "string", minLength: 1, maxLength: BOT_LIMITS.maxNameLength },
        description: { type: "string", maxLength: BOT_LIMITS.maxDescriptionLength },
        language,
        enabled: { type: "boolean" },
      },
      ["botId"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "write_files",
    description: `Atomically create/overwrite files and delete paths in one call, then bump the bot's revision. Limits: ${BOT_LIMITS.maxFiles} files, ${BOT_LIMITS.maxFileBytes} bytes per file, ${BOT_LIMITS.maxTotalBytes} bytes in total. Paths are relative, use only letters, digits, . _ - /, and may not start with "." or contain node_modules.`,
    scope: "write",
    inputSchema: schema(
      {
        botId,
        files: {
          type: "array",
          maxItems: BOT_LIMITS.maxFiles,
          items: schema({ path: { type: "string" }, content: { type: "string" } }, [
            "path",
            "content",
          ]),
        },
        deletePaths: {
          type: "array",
          maxItems: BOT_LIMITS.maxFiles,
          items: { type: "string" },
        },
      },
      ["botId"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "set_env",
    description: `Set and remove environment variables for a bot. Values are write-only: they are stored sealed and never returned. Names match ^[A-Z_][A-Z0-9_]*$ and may not start with AULORA_. At most ${BOT_LIMITS.maxEnvVars} variables, ${BOT_LIMITS.maxEnvValueBytes} bytes per value.`,
    scope: "write",
    inputSchema: schema(
      {
        botId,
        set: {
          type: "array",
          maxItems: BOT_LIMITS.maxEnvVars,
          items: schema({ name: { type: "string" }, value: { type: "string" } }, ["name", "value"]),
        },
        remove: {
          type: "array",
          maxItems: BOT_LIMITS.maxEnvVars,
          items: { type: "string" },
        },
      },
      ["botId"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "restart_bot",
    description: "Ask the runner to relaunch a bot without changing its code or settings.",
    scope: "write",
    inputSchema: schema({ botId }, ["botId"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
];

/** The tools a token of `scope` may list and call (`write` includes every read tool). */
export function toolsForScope(scope: BotMcpScope): readonly McpToolDef[] {
  return scope === BOT_MCP_SCOPES[1] ? [...READ_TOOLS, ...WRITE_TOOLS] : READ_TOOLS;
}

/** The tool named `name` if `scope` allows it; unknown and forbidden look the same. */
export function findTool(scope: BotMcpScope, name: string): McpToolDef | undefined {
  return toolsForScope(scope).find((tool) => tool.name === name);
}
