import { normalizeServerUrl } from "./server-url";

export interface WellKnownLocalAuth {
  readonly enabled: boolean;
  readonly signup: boolean;
}

export interface WellKnownOAuthProvider {
  readonly id: string;
  readonly type: "oauth";
  readonly displayName: string;
}

export interface WellKnownOidcProvider {
  readonly id: string;
  readonly type: "oidc";
  readonly displayName: string;
  readonly issuer: string;
  readonly discoveryUrl: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
}

export type WellKnownProvider = WellKnownOAuthProvider | WellKnownOidcProvider;

export interface WellKnownAuth {
  readonly local: WellKnownLocalAuth;
  readonly providers: readonly WellKnownProvider[];
}

/**
 * Non-secret description of the content-encryption mode. It advertises only
 * the algorithm, key version and key-manager provider; it never carries key
 * material.
 */
export interface WellKnownEncryption {
  readonly mode: "server";
  readonly algorithm: string;
  readonly keyVersion: string;
  readonly provider: string;
}

/**
 * The exact contract served at `<base>/.well-known/aulora.json`.
 *
 * This document is public: it must never carry a `clientSecret`, `secret`,
 * `adminKey`, `privateKey`, `token` or any other credential.
 */
export interface WellKnown {
  readonly name: string;
  readonly version: string;
  readonly apiVersion: number;
  readonly convexUrl: string;
  readonly siteUrl: string;
  readonly iconSeed: string;
  readonly auth: WellKnownAuth;
  readonly encryption?: WellKnownEncryption;
}

export type WellKnownErrorCode =
  | "INVALID_SHAPE"
  | "INVALID_JSON"
  | "SECRET_FIELD"
  | "HTTP_ERROR"
  | "NETWORK_ERROR";

export class WellKnownError extends Error {
  readonly code: WellKnownErrorCode;

  constructor(code: WellKnownErrorCode, message: string) {
    super(message);
    this.name = "WellKnownError";
    this.code = code;
  }
}

export const WELL_KNOWN_PATH = "/.well-known/aulora.json";

const TOP_LEVEL_KEYS = new Set([
  "name",
  "version",
  "apiVersion",
  "convexUrl",
  "siteUrl",
  "iconSeed",
  "auth",
  "encryption",
]);
const AUTH_KEYS = new Set(["local", "providers"]);
const ENCRYPTION_KEYS = new Set(["mode", "algorithm", "keyVersion", "provider"]);
const LOCAL_KEYS = new Set(["enabled", "signup"]);
const OAUTH_KEYS = new Set(["id", "type", "displayName"]);
const OIDC_KEYS = new Set([
  "id",
  "type",
  "displayName",
  "issuer",
  "discoveryUrl",
  "clientId",
  "scopes",
]);

const FORBIDDEN_EXACT = new Set([
  "secret",
  "clientsecret",
  "adminkey",
  "privatekey",
  "token",
  "apikey",
  "password",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
]);
const FORBIDDEN_SUFFIXES = ["secret", "token", "password", "privatekey", "apikey"];

function normaliseKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function looksLikeSecretKey(key: string): boolean {
  const normalised = normaliseKey(key);
  if (FORBIDDEN_EXACT.has(normalised)) {
    return true;
  }
  return FORBIDDEN_SUFFIXES.some((suffix) => normalised.endsWith(suffix));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recursively detects any credential-shaped field name. */
export function containsSecretField(value: unknown, seen: Set<unknown> = new Set()): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsSecretField(item, seen));
  }
  if (!isRecord(value)) {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (looksLikeSecretKey(key)) {
      return true;
    }
    if (containsSecretField(child, seen)) {
      return true;
    }
  }
  return false;
}

function fail(path: string, expected: string): never {
  throw new WellKnownError(
    "INVALID_SHAPE",
    `Invalid well-known document: ${path} must be ${expected}.`,
  );
}

function assertOnlyKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      fail(`${path}.${key}`.replace(/^\./, ""), "a known field");
    }
  }
}

function readString(obj: Record<string, unknown>, key: string, path: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    fail(path, "a non-empty string");
  }
  return value;
}

function readBoolean(obj: Record<string, unknown>, key: string, path: string): boolean {
  const value = obj[key];
  if (typeof value !== "boolean") {
    fail(path, "a boolean");
  }
  return value;
}

function readNumber(obj: Record<string, unknown>, key: string, path: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "a finite number");
  }
  return value;
}

function parseLocalAuth(value: unknown, path: string): WellKnownLocalAuth {
  if (!isRecord(value)) {
    fail(path, "an object");
  }
  assertOnlyKeys(value, LOCAL_KEYS, path);
  return {
    enabled: readBoolean(value, "enabled", `${path}.enabled`),
    signup: readBoolean(value, "signup", `${path}.signup`),
  };
}

function parseProvider(value: unknown, path: string): WellKnownProvider {
  if (!isRecord(value)) {
    fail(path, "an object");
  }
  const type = value.type;
  if (type === "oauth") {
    assertOnlyKeys(value, OAUTH_KEYS, path);
    return {
      id: readString(value, "id", `${path}.id`),
      type: "oauth",
      displayName: readString(value, "displayName", `${path}.displayName`),
    };
  }
  if (type === "oidc") {
    assertOnlyKeys(value, OIDC_KEYS, path);
    const rawScopes = value.scopes;
    if (!Array.isArray(rawScopes) || rawScopes.some((scope) => typeof scope !== "string")) {
      fail(`${path}.scopes`, "an array of strings");
    }
    return {
      id: readString(value, "id", `${path}.id`),
      type: "oidc",
      displayName: readString(value, "displayName", `${path}.displayName`),
      issuer: readString(value, "issuer", `${path}.issuer`),
      discoveryUrl: readString(value, "discoveryUrl", `${path}.discoveryUrl`),
      clientId: readString(value, "clientId", `${path}.clientId`),
      scopes: [...rawScopes],
    };
  }
  fail(`${path}.type`, '"oauth" or "oidc"');
}

function parseAuth(value: unknown, path: string): WellKnownAuth {
  if (!isRecord(value)) {
    fail(path, "an object");
  }
  assertOnlyKeys(value, AUTH_KEYS, path);
  const rawProviders = value.providers;
  if (!Array.isArray(rawProviders)) {
    fail(`${path}.providers`, "an array");
  }
  const providers = rawProviders.map((provider, index) =>
    parseProvider(provider, `${path}.providers[${index}]`),
  );
  return {
    local: parseLocalAuth(value.local, `${path}.local`),
    providers,
  };
}

function parseEncryption(value: unknown, path: string): WellKnownEncryption {
  if (!isRecord(value)) {
    fail(path, "an object");
  }
  assertOnlyKeys(value, ENCRYPTION_KEYS, path);
  const mode = readString(value, "mode", `${path}.mode`);
  if (mode !== "server") {
    fail(`${path}.mode`, '"server"');
  }
  return {
    mode: "server",
    algorithm: readString(value, "algorithm", `${path}.algorithm`),
    keyVersion: readString(value, "keyVersion", `${path}.keyVersion`),
    provider: readString(value, "provider", `${path}.provider`),
  };
}

/**
 * Validates an unknown payload into a {@link WellKnown}. Throws
 * {@link WellKnownError} on any structural problem or secret-shaped field.
 * The payload is never logged.
 */
export function parseWellKnown(value: unknown): WellKnown {
  if (containsSecretField(value)) {
    throw new WellKnownError(
      "SECRET_FIELD",
      "The well-known document must not contain secret fields.",
    );
  }
  if (!isRecord(value)) {
    fail("document", "an object");
  }
  assertOnlyKeys(value, TOP_LEVEL_KEYS, "");
  const encryption =
    value.encryption === undefined ? undefined : parseEncryption(value.encryption, "encryption");
  return {
    name: readString(value, "name", "name"),
    version: readString(value, "version", "version"),
    apiVersion: readNumber(value, "apiVersion", "apiVersion"),
    convexUrl: readString(value, "convexUrl", "convexUrl"),
    siteUrl: readString(value, "siteUrl", "siteUrl"),
    iconSeed: readString(value, "iconSeed", "iconSeed"),
    auth: parseAuth(value.auth, "auth"),
    ...(encryption !== undefined ? { encryption } : {}),
  };
}

export function isWellKnown(value: unknown): value is WellKnown {
  try {
    parseWellKnown(value);
    return true;
  } catch {
    return false;
  }
}

export interface FetchWellKnownOptions {
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

/**
 * Fetches and validates `<base>/.well-known/aulora.json`.
 *
 * @throws {ServerUrlError} when `baseUrl` is not a valid server address.
 * @throws {WellKnownError} on transport, JSON, shape or secret-field problems.
 */
export async function fetchWellKnown(
  baseUrl: string,
  options: FetchWellKnownOptions = {},
): Promise<WellKnown> {
  const url = `${normalizeServerUrl(baseUrl)}${WELL_KNOWN_PATH}`;
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new WellKnownError("NETWORK_ERROR", "No fetch implementation is available.");
  }

  const init: RequestInit = { headers: { accept: "application/json" } };
  if (options.signal !== undefined) {
    init.signal = options.signal;
  }

  let response: Response;
  try {
    response = await doFetch(url, init);
  } catch {
    throw new WellKnownError("NETWORK_ERROR", "Could not reach the Aulora server.");
  }

  if (!response.ok) {
    throw new WellKnownError("HTTP_ERROR", `The Aulora server returned HTTP ${response.status}.`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new WellKnownError("INVALID_JSON", "The Aulora server did not return valid JSON.");
  }

  return parseWellKnown(payload);
}
