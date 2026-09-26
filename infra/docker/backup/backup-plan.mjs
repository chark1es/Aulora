// Pure helpers for the Aulora nightly backup runner.
//
// Kept dependency-free and side-effect-free (except the explicit `prune`
// command) so they can be unit tested with `node --test` without Docker. The
// shell scripts call the CLI at the bottom; the tests import the functions.

import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Compact UTC timestamp used in filenames and object prefixes. */
export function timestamp(now = Date.now()) {
  return new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Convex names its database after the instance, with dashes as underscores. */
export function dbNameFor(instanceName) {
  return String(instanceName).replace(/-/g, "_");
}

/** S3 key prefix for a run, e.g. `backups/20260926T030000Z`. */
export function objectPrefix(ts) {
  return `backups/${ts}`;
}

/** Seconds until the next `hourUtc:00` UTC, always strictly in the future. */
export function nextRunDelay(now, hourUtc) {
  const hour = Number(hourUtc);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`invalid BACKUP_HOUR_UTC: ${hourUtc}`);
  }
  const date = new Date(now);
  let next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, 0, 0, 0);
  if (next <= now) {
    next += 24 * 60 * 60 * 1000;
  }
  return Math.floor((next - now) / 1000);
}

/**
 * Names of run directories to delete, oldest first. Timestamp names sort
 * chronologically; anything that is not a timestamp is ignored. Keeps the
 * newest `retention` entries.
 */
export function prunableDirectories(entries, retention) {
  const keep = Number(retention);
  if (!Number.isInteger(keep) || keep < 0) {
    throw new RangeError(`invalid retention: ${retention}`);
  }
  const runs = entries
    .map((entry) => entry.name)
    .filter((name) => /^\d{8}T\d{6}Z$/.test(name))
    .sort();
  if (runs.length <= keep) {
    return [];
  }
  return runs.slice(0, runs.length - keep);
}

/**
 * Builds the `backups:record` argument JSON from environment values. Missing
 * optionals are omitted so Convex never sees `undefined` fields.
 */
export function recordArgs(env) {
  const startedAt = Number(env.STARTED);
  const payload = {
    token: env.TOKEN ?? "",
    status: env.STATUS ?? "failed",
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    trigger: env.TRIGGER === "manual" ? "manual" : "cron",
  };
  const finishedAt = Number(env.FINISHED);
  if (Number.isFinite(finishedAt)) {
    payload.finishedAt = finishedAt;
  }
  const sizeBytes = Number(env.SIZE);
  if (env.SIZE !== undefined && env.SIZE !== "" && Number.isFinite(sizeBytes) && sizeBytes >= 0) {
    payload.sizeBytes = sizeBytes;
  }
  if (env.LOCATION) {
    payload.location = env.LOCATION;
  }
  if (env.MESSAGE) {
    payload.message = env.MESSAGE;
  }
  return JSON.stringify(payload);
}

/** Deletes run directories beyond `retention` under `dir`; returns the names. */
export function pruneDirectory(dir, retention) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return [];
  }
  const names = prunableDirectories(entries, retention);
  for (const name of names) {
    rmSync(join(dir, name), { recursive: true, force: true });
  }
  return names;
}

function main(argv, env) {
  const [command, ...args] = argv;
  switch (command) {
    case "timestamp":
      return timestamp();
    case "db":
      return dbNameFor(args[0] ?? "aulora");
    case "prefix":
      return objectPrefix(args[0] ?? timestamp());
    case "delay":
      return String(nextRunDelay(Date.now(), args[0] ?? "3"));
    case "record":
      return recordArgs(env);
    case "prune":
      return pruneDirectory(args[0] ?? "/backup", args[1] ?? "7").join(" ");
    default:
      process.stderr.write("backup-plan.mjs: expected timestamp|db|prefix|delay|record|prune\n");
      process.exit(2);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = main(process.argv.slice(2), process.env);
  if (output !== undefined) {
    process.stdout.write(`${output}\n`);
  }
}
