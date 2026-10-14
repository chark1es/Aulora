import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  ENV_CREDENTIAL_GROUPS,
  type EnvVarDefinition,
  findEnvVarDefinition,
  isOverridableEnvVar,
} from "./envCatalog";
import { openString } from "./sse";

/**
 * Effective environment + UI override helpers.
 *
 * An override always wins over the deployment environment, but only for keys
 * in the catalog's overridable allowlist. Values are sealed with the
 * `aulora-sse-v1` envelope (`lib/sse.ts`) before they reach the database, and
 * nothing in this module ever logs or returns a value that came from the
 * deployment environment. `buildEffectiveEnv` is pure so it can be unit
 * tested; `loadEffectiveEnv` reads + decrypts for query/mutation callers.
 */

export type Env = Record<string, string | undefined>;

/** Read-only view of environment values, keyed by variable name. */
export type EnvLookup = ReadonlyMap<string, string | undefined>;

/** Where a variable's effective value comes from, as shown in the UI. */
export type EnvSource = "environment" | "ui" | "unset";

const SCOPE = "env-override";
const MAX_VALUE_LENGTH = 8192;
const MAX_LIST_ITEMS = 64;
const MAX_LIST_ITEM_LENGTH = 256;

/** Sealing context for one override; the key is bound into the envelope AAD. */
export function envOverrideContext(key: string): { scope: string; recordId: string } {
  return { scope: SCOPE, recordId: key };
}

/** The kill switch; only the exact value "false" disables UI env overrides. */
export function uiEnvOverridesEnabled(env: Env = process.env): boolean {
  return env.AULORA_ALLOW_UI_ENV_OVERRIDES !== "false";
}

export function assertUiEnvOverridesEnabled(env: Env = process.env): void {
  if (!uiEnvOverridesEnabled(env)) {
    throw new ConvexError(
      "Environment overrides are disabled by the deployment (AULORA_ALLOW_UI_ENV_OVERRIDES=false)",
    );
  }
}

/**
 * A Map view of an env, so lookups never index an object with a variable key.
 *
 * Convex's default runtime exposes `process.env` as a Proxy over an empty
 * object whose only trap is `get` (`npm-packages/udf-runtime/src/00_misc.ts`),
 * so `Object.entries(process.env)` is empty and enumerating it yields nothing.
 * Plain objects still enumerate. Callers that read the deployment environment
 * must therefore pass the keys they care about explicitly.
 */
export function envLookup(env: Env = process.env, keys?: Iterable<string>): EnvLookup {
  const lookup = new Map<string, string | undefined>();
  for (const key of Object.keys(env)) {
    lookup.set(key, env[key]);
  }
  if (keys !== undefined) {
    for (const key of keys) {
      lookup.set(key, env[key]);
    }
  }
  return lookup;
}

export function isEnvValueSet(lookup: EnvLookup, key: string): boolean {
  const value = lookup.get(key);
  return value !== undefined && value.trim().length > 0;
}

export function envVarSource(
  key: string,
  overrideKeys: ReadonlySet<string>,
  lookup: EnvLookup,
): EnvSource {
  if (overrideKeys.has(key)) {
    return "ui";
  }
  return isEnvValueSet(lookup, key) ? "environment" : "unset";
}

/**
 * The effective environment: `base` overlaid by decrypted overrides. An
 * override wins even when the deployment variable is set. Keys that are not in
 * the overridable allowlist are ignored, so a stale row can never smuggle in a
 * bootstrap variable.
 */
export function buildEffectiveEnv(base: Env, overrides: ReadonlyMap<string, string>): Env {
  const applied = new Map<string, string>();
  for (const [key, value] of overrides) {
    if (isOverridableEnvVar(key) && value.trim().length > 0) {
      applied.set(key, value);
    }
  }
  // Credential groups come from a single source: once any member is
  // overridden, the rest stop inheriting the deployment value.
  const removed = new Set<string>();
  for (const group of ENV_CREDENTIAL_GROUPS) {
    if (group.some((key) => applied.has(key))) {
      for (const key of group) {
        if (!applied.has(key)) {
          removed.add(key);
        }
      }
    }
  }
  return envOverlay(base, applied, removed);
}

/** Descriptor reported for overlay-only keys so enumeration stays consistent. */
const OVERLAY_DESCRIPTOR: PropertyDescriptor = {
  configurable: true,
  enumerable: true,
  writable: true,
  value: undefined,
};

/**
 * `base` with `applied` overlaid and `removed` hidden. A Proxy, not a copy:
 * Convex's default runtime exposes `process.env` as a non-enumerable Proxy, so
 * `Object.entries`/spread on it are empty and copying `base` would silently drop
 * every deployment variable. Forwarding reads through to `base` keeps them.
 */
function envOverlay(
  base: Env,
  applied: ReadonlyMap<string, string>,
  removed: ReadonlySet<string>,
): Env {
  const handler: ProxyHandler<Env> = {
    get(target, prop, receiver) {
      if (typeof prop === "string" && removed.has(prop)) return undefined;
      const override = typeof prop === "string" ? applied.get(prop) : undefined;
      if (override !== undefined) return override;
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (typeof prop === "string" && removed.has(prop)) return false;
      if (typeof prop === "string" && applied.has(prop)) return true;
      return Reflect.has(target, prop);
    },
    ownKeys(target) {
      const keys = new Set<string | symbol>(Reflect.ownKeys(target));
      for (const key of applied.keys()) keys.add(key);
      for (const key of removed) keys.delete(key);
      return [...keys];
    },
    getOwnPropertyDescriptor(target, prop) {
      return Reflect.getOwnPropertyDescriptor(target, prop) ?? OVERLAY_DESCRIPTOR;
    },
  };
  return new Proxy(base, handler);
}

export interface SealedEnvOverride {
  readonly key: string;
  readonly valueCiphertext: string;
}

/**
 * Decrypts sealed override rows. A row that cannot be opened (tampered
 * ciphertext, rotated key, unprimed remote key manager) is skipped so callers
 * fall back to the deployment environment instead of failing the request.
 */
export async function decryptSealedOverrides(
  rows: readonly SealedEnvOverride[],
): Promise<Map<string, string>> {
  const values = new Map<string, string>();
  for (const row of rows) {
    if (!isOverridableEnvVar(row.key)) {
      continue;
    }
    try {
      const value = await openString(envOverrideContext(row.key), row.valueCiphertext);
      if (value.trim().length > 0) {
        values.set(row.key, value);
      }
    } catch {
      // Fall back to the deployment value; errors are never surfaced or logged.
    }
  }
  return values;
}

export async function effectiveEnvFromSealed(
  base: Env,
  rows: readonly SealedEnvOverride[],
): Promise<Env> {
  return buildEffectiveEnv(base, await decryptSealedOverrides(rows));
}

export interface EffectiveEnv {
  readonly env: Env;
  /** Every key with an override row, decrypted or not (drives source badges). */
  readonly overridden: ReadonlySet<string>;
  /** Keys whose sealed value was successfully applied (drives value echoes). */
  readonly applied: ReadonlySet<string>;
}

/** Reads + decrypts overrides for a query/mutation. `env` is safe to consume. */
export async function loadEffectiveEnv(
  ctx: QueryCtx | MutationCtx,
  base: Env = process.env,
): Promise<EffectiveEnv> {
  const rows = await ctx.db.query("envOverrides").collect();
  const sealed: SealedEnvOverride[] = rows.map((row) => ({
    key: row.key,
    valueCiphertext: row.valueCiphertext,
  }));
  const applied = await decryptSealedOverrides(sealed);
  return {
    env: buildEffectiveEnv(base, applied),
    overridden: new Set(sealed.map((row) => row.key)),
    applied: new Set(applied.keys()),
  };
}

function validateUrlValue(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConvexError("Enter an absolute URL");
  }
  const host = parsed.hostname;
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (/^(169\.254\.|\[?fe80:)/i.test(host)) {
    throw new ConvexError("Link-local addresses are not allowed");
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal)) {
    throw new ConvexError("Use an https URL (http is allowed only for localhost)");
  }
  return value;
}

function validateNumberValue(definition: EnvVarDefinition, value: string): string {
  if (!/^\d+$/.test(value)) {
    throw new ConvexError("Enter a whole number");
  }
  const parsed = Number(value);
  if (definition.min !== undefined && parsed < definition.min) {
    throw new ConvexError(`Must be at least ${definition.min}`);
  }
  if (definition.max !== undefined && parsed > definition.max) {
    throw new ConvexError(`Must be at most ${definition.max}`);
  }
  return String(parsed);
}

function validateBooleanValue(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized !== "true" && normalized !== "false") {
    throw new ConvexError('Enter "true" or "false"');
  }
  return normalized;
}

function validateEnumValue(definition: EnvVarDefinition, value: string): string {
  const allowed = definition.enumValues ?? [];
  if (!allowed.includes(value)) {
    throw new ConvexError(`Allowed values: ${allowed.join(", ")}`);
  }
  return value;
}

function validateListValue(value: string): string {
  const items = value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (items.length === 0) {
    throw new ConvexError("Enter at least one value");
  }
  if (items.length > MAX_LIST_ITEMS) {
    throw new ConvexError(`Use at most ${MAX_LIST_ITEMS} values`);
  }
  for (const item of items) {
    if (item.length > MAX_LIST_ITEM_LENGTH) {
      throw new ConvexError(`Each value must be at most ${MAX_LIST_ITEM_LENGTH} characters`);
    }
  }
  return items.join(" ");
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new ConvexError("Enter valid JSON");
  }
}

function validateIceServers(parsed: unknown): void {
  if (!Array.isArray(parsed)) {
    throw new ConvexError("Enter a JSON array of ICE servers");
  }
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) {
      throw new ConvexError("Each ICE server must be a JSON object with urls");
    }
    const urls = (entry as Record<string, unknown>).urls;
    const list = Array.isArray(urls) ? urls : [urls];
    if (!list.some((url) => typeof url === "string" && url.trim().length > 0)) {
      throw new ConvexError("Each ICE server needs at least one URL");
    }
  }
}

function validateGroupRoleMap(parsed: unknown): void {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConvexError("Enter a JSON object mapping groups to role names");
  }
  for (const value of Object.values(parsed as Record<string, unknown>)) {
    const names = Array.isArray(value) ? value : [value];
    if (!names.some((name) => typeof name === "string" && name.trim().length > 0)) {
      throw new ConvexError("Each group must map to a role name or a list of role names");
    }
  }
}

function validateJsonValue(definition: EnvVarDefinition, value: string): string {
  const parsed = parseJsonValue(value);
  if (parsed === null || typeof parsed !== "object") {
    throw new ConvexError("Enter a JSON object or array");
  }
  if (definition.format === "ice-servers") {
    validateIceServers(parsed);
  }
  if (definition.format === "group-role-map") {
    validateGroupRoleMap(parsed);
  }
  return value;
}

function normalizedTypeValue(definition: EnvVarDefinition, value: string): string {
  switch (definition.type) {
    case "url":
      return validateUrlValue(value);
    case "number":
      return validateNumberValue(definition, value);
    case "boolean":
      return validateBooleanValue(value);
    case "enum":
      return validateEnumValue(definition, value);
    case "list":
      return validateListValue(value);
    case "json":
      return validateJsonValue(definition, value);
    case "string":
      return value;
  }
}

/** Validates and normalizes one override value, or throws a domain error. */
export function validateEnvOverrideValue(key: string, rawValue: string): string {
  const definition = findEnvVarDefinition(key);
  if (definition === undefined) {
    throw new ConvexError(`Unknown environment variable: ${key}`);
  }
  if (!definition.overridable) {
    throw new ConvexError(`${key} is managed by the deployment and cannot be overridden`);
  }
  const value = rawValue.trim();
  if (value.length === 0) {
    throw new ConvexError("Enter a value");
  }
  if (value.length > MAX_VALUE_LENGTH) {
    throw new ConvexError(`Values must be at most ${MAX_VALUE_LENGTH} characters`);
  }
  return normalizedTypeValue(definition, value);
}
