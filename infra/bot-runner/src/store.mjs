// Writes a bot bundle into its work directory.
//
// The server validates file paths too, but the runner refuses anything that
// escapes the bot's directory on its own: defense in depth costs nothing and
// the runner is the component that touches the filesystem.

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  chownSync,
  mkdirSync,
  readdirSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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

/**
 * Runs one filesystem operation on a path this module has already validated.
 *
 * Every `target` passed here comes from `isSafeBotId()` (the bot's work
 * directory) or `resolveWithin()` (a bundle file under it); both reject any
 * path that escapes the bot directory. Centralising the calls keeps that
 * reasoning in one place instead of repeating it at every site, and keeps the
 * false-positive suppression below singular.
 */
function onBotPath(target, operation, ...args) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `target` is always isSafeBotId()/resolveWithin() output, which cannot escape the bot directory.
  return operation(target, ...args);
}

/**
 * Deletes a bot directory. Once the supervisor (root, with only SETUID, SETGID
 * CHOWN and KILL) has handed a directory to a bot's uid at mode 0700 it can no longer
 * read or empty it, so the contents are deleted as that uid first and only the
 * now-empty directory is removed by the supervisor.
 */
function removeTree(dir) {
  let owner;
  try {
    owner = onBotPath(dir, statSync);
  } catch {
    return;
  }
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  if (isRoot && owner.uid !== 0) {
    spawnSync("find", [dir, "-mindepth", "1", "-delete"], {
      uid: owner.uid,
      gid: owner.gid,
      stdio: "ignore",
    });
  }
  // The directory is empty now, and the supervisor cannot read a directory owned
  // by a bot (recursive rm would try), but removing an empty one needs no read.
  if (isRoot && owner.uid !== 0) {
    onBotPath(dir, rmdirSync);
    return;
  }
  rmSync(dir, { recursive: true, force: true });
}

/** Removes then recreates the bot directory with mode 0700. */
export function resetBotDir(dir) {
  removeTree(dir);
  onBotPath(dir, mkdirSync, { recursive: true, mode: 0o700 });
  onBotPath(dir, chmodSync, 0o700);
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
    const parent = dirname(target);
    onBotPath(parent, mkdirSync, { recursive: true, mode: 0o700 });
    onBotPath(parent, chmodSync, 0o700);
    onBotPath(target, writeFileSync, String(file?.content ?? ""), { mode: 0o600 });
    written.push(file.path);
  }
  return written;
}

/**
 * Recursively chowns `dir`; used only when the supervisor runs as root. Children
 * go first and the directory last: once it belongs to the bot at mode 0700 the
 * supervisor can no longer list it.
 */
export function chownTree(dir, uid, gid) {
  for (const entry of onBotPath(dir, readdirSync, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) chownTree(path, uid, gid);
    else onBotPath(path, chownSync, uid, gid);
  }
  onBotPath(dir, chownSync, uid, gid);
}

export function removeBotDir(dir) {
  removeTree(dir);
}
