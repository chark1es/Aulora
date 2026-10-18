/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { BOT_LIMITS, type BotLanguage, type PermissionName } from "@aulora/core";
import type { BotStatus } from "../../../../../../packages/convex/convex/lib/botTypes";

/**
 * Pure helpers for the Bots admin surface: labels, status colours, the source
 * file and environment rules (mirrored from the server so a mistake is caught
 * before a round-trip), and the diffing that decides what `bots.saveFiles`
 * receives. No component or server state lives here.
 */

export const BOT_LANGUAGE_LABELS: Readonly<Record<BotLanguage, string>> = {
  typescript: "TypeScript",
  python: "Python",
};

export const BOT_TEMPLATE_LABELS = {
  hello: "Hello bot",
  blank: "Blank",
} as const;

export type BotTemplate = keyof typeof BOT_TEMPLATE_LABELS;

export interface BotStatusMeta {
  readonly label: string;
  readonly dotClass: string;
  readonly textClass: string;
}

export const BOT_STATUS_META: Readonly<Record<BotStatus, BotStatusMeta>> = {
  stopped: { label: "Stopped", dotClass: "bg-text-muted", textClass: "text-text-muted" },
  starting: { label: "Starting", dotClass: "animate-pulse bg-accent", textClass: "text-accent" },
  running: { label: "Running", dotClass: "bg-secondary", textClass: "text-secondary" },
  crashed: { label: "Crashed", dotClass: "bg-danger", textClass: "text-danger" },
};

export const BOT_RUNNER_OFFLINE_MESSAGE =
  "The bot runner is not running. Start it with `docker compose --profile bots up -d`.";

/** Powerful grants that deserve a line of caution beside the checkbox. */
export const BOT_CAUTION_PERMISSIONS: Partial<Record<PermissionName, string>> = {
  ManageMessages: "Can delete or edit anyone's messages.",
  Kick: "Can remove members from the workspace.",
  Ban: "Can ban members and keep them from rejoining.",
  Timeout: "Can mute members for a while.",
  MentionEveryone: "Can mention @everyone and every role.",
};

/** Why a blocked bit can never be granted to a bot. */
export const BOT_BLOCKED_REASONS: Partial<Record<PermissionName, string>> = {
  Administrator: "Would give the bot full control of the workspace.",
  ManageRoles: "Bots cannot change roles.",
  ManageWorkspace: "Bots cannot change workspace settings.",
  ManageBots: "Bots cannot create or change other bots.",
  CreateInvites: "Bots cannot invite people.",
  DeleteInvites: "Bots cannot manage invites.",
  ViewAuditLog: "Bots cannot read the audit log.",
};

const BOT_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const BOT_PATH_MAX_LENGTH = 128;
const BOT_ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const BOT_ENV_RESERVED_PREFIX = "AULORA_";
const UTF8 = new TextEncoder();

/** UTF-8 byte length, the unit every bot size limit is measured in. */
export function botFileBytes(content: string): number {
  return UTF8.encode(content).byteLength;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function validateBotName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "Give the bot a name";
  }
  if (trimmed.length > BOT_LIMITS.maxNameLength) {
    return `Names are at most ${BOT_LIMITS.maxNameLength} characters`;
  }
  return null;
}

export function validateBotDescription(description: string): string | null {
  return description.trim().length > BOT_LIMITS.maxDescriptionLength
    ? `Descriptions are at most ${BOT_LIMITS.maxDescriptionLength} characters`
    : null;
}

/** Null when `path` is a valid relative source path that is not already taken. */
export function validateBotPath(path: string, taken: readonly string[] = []): string | null {
  if (path.length === 0 || path.length > BOT_PATH_MAX_LENGTH) {
    return `File paths must be 1 to ${BOT_PATH_MAX_LENGTH} characters`;
  }
  if (path.startsWith("/") || path.startsWith(".")) {
    return "File paths must be relative and may not start with '.' or '/'";
  }
  if (!BOT_PATH_PATTERN.test(path)) {
    return "File paths may only contain letters, digits, '.', '_', '-' and '/'";
  }
  for (const segment of path.split("/")) {
    if (segment.length === 0) {
      return "File paths may not contain empty segments";
    }
    if (segment === "." || segment === "..") {
      return "File paths may not contain '.' or '..' segments";
    }
    if (segment === "node_modules") {
      return "File paths may not include node_modules";
    }
  }
  if (taken.includes(path)) {
    return "A file with that path already exists";
  }
  return null;
}

/** Null when `name` is a valid environment variable name. */
export function validateBotEnvName(name: string): string | null {
  if (!BOT_ENV_NAME_PATTERN.test(name)) {
    return "Environment names must match [A-Z_][A-Z0-9_]*";
  }
  if (name.startsWith(BOT_ENV_RESERVED_PREFIX)) {
    return `Environment names may not start with ${BOT_ENV_RESERVED_PREFIX}`;
  }
  return null;
}

export interface BotFileInput {
  readonly path: string;
  readonly content: string;
}

/** Appends a file unless the count cap is already reached. */
export function addBotFile(files: readonly BotFileInput[], path: string): readonly BotFileInput[] {
  return files.length >= BOT_LIMITS.maxFiles ? files : [...files, { path, content: "" }];
}

export function renameBotFile(
  files: readonly BotFileInput[],
  from: string,
  to: string,
): readonly BotFileInput[] {
  return files.map((file) => (file.path === from ? { ...file, path: to } : file));
}

export function removeBotFile(
  files: readonly BotFileInput[],
  path: string,
): readonly BotFileInput[] {
  return files.filter((file) => file.path !== path);
}

export function setBotFileContent(
  files: readonly BotFileInput[],
  path: string | null,
  content: string,
): readonly BotFileInput[] {
  return files.map((file) => (file.path === path ? { ...file, content } : file));
}

/** The final file set is over a limit: a per-file or total byte cap, or count. */
export function botFilesLimitError(files: readonly BotFileInput[]): string | null {
  if (files.length > BOT_LIMITS.maxFiles) {
    return `A bot may have at most ${BOT_LIMITS.maxFiles} files`;
  }
  let total = 0;
  for (const file of files) {
    const bytes = botFileBytes(file.content);
    if (bytes > BOT_LIMITS.maxFileBytes) {
      return `${file.path} is over ${formatBytes(BOT_LIMITS.maxFileBytes)}`;
    }
    total += bytes;
  }
  if (total > BOT_LIMITS.maxTotalBytes) {
    return `A bot's files may total at most ${formatBytes(BOT_LIMITS.maxTotalBytes)}`;
  }
  return null;
}

export interface BotFileDiff {
  readonly upserts: readonly BotFileInput[];
  readonly deletePaths: readonly string[];
  readonly dirty: boolean;
}

/** The `bots.saveFiles` payload fields for a draft diff, minus the bot id. */
export function botSaveArgs(diff: BotFileDiff): {
  files: BotFileInput[];
  deletePaths?: string[];
} {
  return {
    files: [...diff.upserts],
    ...(diff.deletePaths.length > 0 ? { deletePaths: [...diff.deletePaths] } : {}),
  };
}

/** Upserts only changed files and lists the ones dropped since `original`. */
export function filesDiff(
  original: readonly BotFileInput[],
  draft: readonly BotFileInput[],
): BotFileDiff {
  const originalByPath = new Map(original.map((file) => [file.path, file.content]));
  const upserts: BotFileInput[] = [];
  for (const file of draft) {
    if (originalByPath.get(file.path) !== file.content) {
      upserts.push({ path: file.path, content: file.content });
    }
  }
  const draftPaths = new Set(draft.map((file) => file.path));
  const deletePaths = original
    .filter((file) => !draftPaths.has(file.path))
    .map((file) => file.path);
  return { upserts, deletePaths, dirty: upserts.length > 0 || deletePaths.length > 0 };
}
