import { BOT_LIMITS } from "@aulora/core";
import { ConvexError } from "convex/values";
import { openContent } from "./sealed";
import { type EncryptionContext, sealString } from "./sse";

/**
 * Validation and sealing helpers for hosted-bot source files and environment
 * variables. Paths and names are checked here before they reach the database.
 * `botFiles` has no size column, so callers size decoded content themselves.
 */

const PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const RESERVED_ENV_PREFIX = "AULORA_";
const MAX_PATH_LENGTH = 128;
const BLOCKED_SEGMENT = "node_modules";
const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder();

/** UTF-8 byte length of `content`, the unit every bot limit is measured in. */
export function botFileByteLength(content: string): number {
  return utf8.encode(content).byteLength;
}

/** Clips `text` to at most `maxBytes` UTF-8 bytes without keeping a split codepoint. */
export function clipToBytes(text: string, maxBytes: number): string {
  const encoded = utf8.encode(text);
  if (encoded.byteLength <= maxBytes) {
    return text;
  }
  return utf8Decoder.decode(encoded.subarray(0, maxBytes)).replace(/\uFFFD$/, "");
}

/**
 * A relative source path: `[A-Za-z0-9._/-]`, no empty/`..`/`.` segments and no
 * `node_modules`. Throws with a message an admin can act on.
 */
export function validateBotFilePath(path: string): string {
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) {
    throw new ConvexError(`File paths must be 1 to ${MAX_PATH_LENGTH} characters`);
  }
  if (path.startsWith("/") || path.startsWith(".")) {
    throw new ConvexError("File paths must be relative and may not start with '.' or '/'");
  }
  if (!PATH_PATTERN.test(path)) {
    throw new ConvexError("File paths may only contain letters, digits, '.', '_', '-' and '/'");
  }
  for (const segment of path.split("/")) {
    if (segment.length === 0) {
      throw new ConvexError("File paths may not contain empty segments");
    }
    if (segment === "." || segment === "..") {
      throw new ConvexError("File paths may not contain '.' or '..' segments");
    }
    if (segment === BLOCKED_SEGMENT) {
      throw new ConvexError("File paths may not include node_modules");
    }
  }
  return path;
}

/** An environment variable name: `[A-Z_][A-Z0-9_]*`, never namespaced `AULORA_`. */
export function validateBotEnvName(name: string): string {
  if (!ENV_NAME_PATTERN.test(name)) {
    throw new ConvexError("Environment names must match [A-Z_][A-Z0-9_]*");
  }
  if (name.startsWith(RESERVED_ENV_PREFIX)) {
    throw new ConvexError(`Environment names may not start with ${RESERVED_ENV_PREFIX}`);
  }
  return name;
}

export function validateBotEnvValue(value: string): string {
  if (botFileByteLength(value) > BOT_LIMITS.maxEnvValueBytes) {
    throw new ConvexError(
      `Environment values must be at most ${BOT_LIMITS.maxEnvValueBytes} bytes`,
    );
  }
  return value;
}

/** Sealing context for one bot's source files; the bot id is bound into the AAD. */
export function botFileContext(botId: string): EncryptionContext {
  return { scope: "bot.file", recordId: botId };
}

/** Sealing context for one bot's environment object. */
export function botEnvContext(botId: string): EncryptionContext {
  return { scope: "bot.env", recordId: botId };
}

/** Sealing context for one bot's captured logs. */
export function botLogContext(botId: string): EncryptionContext {
  return { scope: "bot.log", recordId: botId };
}

export async function sealBotFileContent(botId: string, content: string): Promise<string> {
  return await sealString(botFileContext(botId), content);
}

export async function openBotFileContent(botId: string, ciphertext: string): Promise<string> {
  return await openContent(botFileContext(botId), ciphertext);
}

export async function sealBotEnv(
  botId: string,
  values: ReadonlyMap<string, string>,
): Promise<string> {
  return await sealString(botEnvContext(botId), JSON.stringify(Object.fromEntries(values)));
}

/**
 * Opens the sealed environment object into a Map. Absent ciphertext is empty.
 * Names are re-validated so a tampered row cannot introduce reserved variables.
 */
export async function openBotEnv(
  botId: string,
  ciphertext: string | undefined,
): Promise<Map<string, string>> {
  if (ciphertext === undefined) {
    return new Map();
  }
  const plaintext = await openContent(botEnvContext(botId), ciphertext);
  if (plaintext.trim().length === 0) {
    return new Map();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new ConvexError("Stored bot environment is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConvexError("Stored bot environment is not an object");
  }
  const values = new Map<string, string>();
  for (const [name, value] of Object.entries(parsed)) {
    validateBotEnvName(name);
    if (typeof value !== "string") {
      throw new ConvexError(`Environment value for ${name} is not a string`);
    }
    values.set(name, value);
  }
  return values;
}
