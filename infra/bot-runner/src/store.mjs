// Writes a bot bundle into its work directory.
//
// The server validates file paths too, but the runner refuses anything that
// escapes the bot's directory on its own: defense in depth costs nothing and
// the runner is the component that touches the filesystem.

import { chmodSync, chownSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

export const MAX_PATH_LENGTH = 128;
const ALLOWED_CHARS = /^[A-Za-z0-9._/-]+$/;
const ALLOWED_SEGMENT = /^[A-Za-z0-9._-]+$/;
const ALLOWED_BOT_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** A bot id is used as a directory name; refuse anything that is not one segment. */
export function isSafeBotId(botId) {
  return typeof botId === "string" && ALLOWED_BOT_ID.test(botId);
}

/**
 * Validates a bundle file path and returns the normalized relative path, or
 * null when it is unsafe. Matches BOT_LIMITS in core: relative, no `..`, no
 * leading dot-only segment, no `node_modules/`, ≤ 128 chars.
 */
export function safeRelativePath(relative) {
  if (typeof relative !== "string" || relative.length === 0) return null;
  if (relative.length > MAX_PATH_LENGTH) return null;
  if (!ALLOWED_CHARS.test(relative)) return null;
  const segments = relative.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") return null;
    if (segment === "node_modules") return null;
    if (!ALLOWED_SEGMENT.test(segment)) return null;
  }
  return segments.join("/");
}

/** Resolves `relative` under `root`, refusing anything that escapes `root`. */
export function resolveWithin(root, relative) {
  const safe = safeRelativePath(relative);
  if (safe === null) return null;
  const normalizedRoot = resolve(root);
  const target = resolve(normalizedRoot, safe);
  const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep;
  return target.startsWith(prefix) ? target : null;
}

/** Removes then recreates the bot directory with mode 0700. */
export function resetBotDir(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}

/** Writes bundle files under `dir`; throws when any path escapes it. */
export function writeBundleFiles(dir, files) {
  if (!Array.isArray(files)) return [];
  const written = [];
  for (const file of files) {
    const target = resolveWithin(dir, file?.path);
    if (target === null) {
      throw new Error(`refusing unsafe bot file path: ${String(file?.path)}`);
    }
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    chmodSync(dirname(target), 0o700);
    writeFileSync(target, String(file?.content ?? ""), { mode: 0o600 });
    written.push(file.path);
  }
  return written;
}

/** Recursively chowns `dir`; used only when the supervisor runs as root. */
export function chownTree(dir, uid, gid) {
  chownSync(dir, uid, gid);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) chownTree(path, uid, gid);
    else chownSync(path, uid, gid);
  }
}

export function removeBotDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}
