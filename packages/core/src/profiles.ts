import { normalizeServerUrl } from "./server-url";
import type { WellKnown, WellKnownAuth, WellKnownProvider } from "./well-known";

/**
 * A stored connection to one Aulora workspace. Never contains credentials:
 * the client re-authenticates per server and holds sessions separately.
 */
export interface ServerProfile {
  readonly id: string;
  readonly baseUrl: string;
  readonly name: string;
  readonly iconSeed: string;
  readonly version: string;
  readonly apiVersion: number;
  readonly convexUrl: string;
  readonly siteUrl: string;
  readonly auth: WellKnownAuth;
  readonly addedAt: number;
}

export interface ProfileStore {
  list(): Promise<ServerProfile[]>;
  get(id: string): Promise<ServerProfile | undefined>;
  add(profile: ServerProfile): Promise<void>;
  remove(id: string): Promise<void>;
  setActive(id: string): Promise<void>;
  getActive(): Promise<ServerProfile | undefined>;
}

export class UnknownProfileError extends Error {
  readonly id: string;

  constructor(id: string) {
    super(`Unknown server profile: ${id}`);
    this.name = "UnknownProfileError";
    this.id = id;
  }
}

function cloneProvider(provider: WellKnownProvider): WellKnownProvider {
  if (provider.type === "oidc") {
    return {
      id: provider.id,
      type: "oidc",
      displayName: provider.displayName,
      issuer: provider.issuer,
      discoveryUrl: provider.discoveryUrl,
      clientId: provider.clientId,
      scopes: [...provider.scopes],
    };
  }
  return {
    id: provider.id,
    type: "oauth",
    displayName: provider.displayName,
  };
}

function cloneAuth(auth: WellKnownAuth): WellKnownAuth {
  return {
    local: { enabled: auth.local.enabled, signup: auth.local.signup },
    providers: auth.providers.map(cloneProvider),
  };
}

/** Loopback hosts, including bracketed IPv6 literals returned by `URL`. */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") {
    return true;
  }
  return host.endsWith(".localhost") || /^127\./.test(host);
}

/** True when `advertised` parses as a URL pointing at a loopback host. */
function isLoopbackUrl(advertised: string): boolean {
  try {
    return isLoopbackHost(new URL(advertised).hostname);
  } catch {
    return false;
  }
}

/**
 * Resolves the Convex URL a client should talk to.
 *
 * When the server advertises a loopback Convex URL it means "this deployment's
 * default", not a reachable address: the client uses the very origin it reached
 * the server on. The web edge serves Convex under that same origin at `/api`
 * (see `infra/docker/nginx/default.conf.template`), so one URL works for localhost, the
 * LAN, Tailscale, a tunnel or the operator's own HTTPS proxy. A public
 * (non-loopback) advertised URL is trusted as-is.
 */
function resolveConvexUrl(advertised: string, base: URL): string {
  return isLoopbackUrl(advertised) ? `${base.protocol}//${base.host}` : advertised;
}

/** Stable profile id: the canonical base URL is already unique per server. */
export function profileId(baseUrl: string): string {
  return normalizeServerUrl(baseUrl);
}

/** Builds a sanitized profile from a validated well-known document. */
export function createServerProfile(
  baseUrl: string,
  wellKnown: WellKnown,
  addedAt: number = Date.now(),
): ServerProfile {
  const canonical = normalizeServerUrl(baseUrl);
  const base = new URL(canonical);
  const convexUrl = resolveConvexUrl(wellKnown.convexUrl, base);
  const siteUrl = isLoopbackUrl(wellKnown.siteUrl)
    ? `${base.protocol}//${base.host}`
    : wellKnown.siteUrl;
  return {
    id: canonical,
    baseUrl: canonical,
    name: wellKnown.name,
    iconSeed: wellKnown.iconSeed,
    version: wellKnown.version,
    apiVersion: wellKnown.apiVersion,
    convexUrl,
    siteUrl,
    auth: cloneAuth(wellKnown.auth),
    addedAt,
  };
}

const PROFILES_KEY = "aulora.profiles.v1";
const ACTIVE_PROFILE_KEY = "aulora.activeProfile.v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WebLocalStorageStoreOptions {
  readonly storage?: StorageLike;
  readonly profilesKey?: string;
  readonly activeKey?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sanitizeProvider(value: unknown): WellKnownProvider | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readOptionalString(value.id);
  const displayName = readOptionalString(value.displayName);
  if (id === null || displayName === null) {
    return null;
  }
  if (value.type === "oauth") {
    return { id, type: "oauth", displayName };
  }
  if (value.type === "oidc") {
    const issuer = readOptionalString(value.issuer);
    const discoveryUrl = readOptionalString(value.discoveryUrl);
    const clientId = readOptionalString(value.clientId);
    const rawScopes = value.scopes;
    const scopes = Array.isArray(rawScopes)
      ? rawScopes.filter((scope): scope is string => typeof scope === "string")
      : null;
    if (issuer === null || discoveryUrl === null || clientId === null || scopes === null) {
      return null;
    }
    return { id, type: "oidc", displayName, issuer, discoveryUrl, clientId, scopes };
  }
  return null;
}

function sanitizeStoredAuth(value: unknown): WellKnownAuth | null {
  if (!isRecord(value) || !isRecord(value.local) || !Array.isArray(value.providers)) {
    return null;
  }
  const providers = value.providers
    .map(sanitizeProvider)
    .filter((p): p is WellKnownProvider => p !== null);
  return {
    local: {
      enabled: value.local.enabled === true,
      signup: value.local.signup === true,
    },
    providers,
  };
}

function sanitizeStoredProfile(value: unknown): ServerProfile | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readOptionalString(value.id);
  const baseUrl = readOptionalString(value.baseUrl);
  const name = readOptionalString(value.name);
  const iconSeed = readOptionalString(value.iconSeed);
  const version = readOptionalString(value.version);
  const convexUrl = readOptionalString(value.convexUrl);
  const siteUrl = readOptionalString(value.siteUrl);
  const apiVersion = typeof value.apiVersion === "number" ? value.apiVersion : null;
  const addedAt = typeof value.addedAt === "number" ? value.addedAt : 0;
  const auth = sanitizeStoredAuth(value.auth);
  if (
    id === null ||
    baseUrl === null ||
    name === null ||
    iconSeed === null ||
    version === null ||
    convexUrl === null ||
    siteUrl === null ||
    apiVersion === null ||
    auth === null
  ) {
    return null;
  }
  return {
    id,
    baseUrl,
    name,
    iconSeed,
    version,
    apiVersion,
    convexUrl,
    siteUrl,
    auth,
    addedAt,
  };
}

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function defaultStorage(): StorageLike {
  const candidate = (globalThis as { localStorage?: unknown }).localStorage;
  if (isRecord(candidate)) {
    const storage = candidate as unknown as StorageLike;
    if (
      typeof storage.getItem === "function" &&
      typeof storage.setItem === "function" &&
      typeof storage.removeItem === "function"
    ) {
      return storage;
    }
  }
  return memoryStorage();
}

/** In-memory {@link ProfileStore} for tests and non-browser hosts. */
export function createMemoryProfileStore(seed: readonly ServerProfile[] = []): ProfileStore {
  const profiles = new Map<string, ServerProfile>();
  for (const profile of seed) {
    profiles.set(profile.id, profile);
  }
  let activeId: string | null = null;

  return {
    list() {
      return Promise.resolve([...profiles.values()]);
    },
    get(id) {
      return Promise.resolve(profiles.get(id));
    },
    add(profile) {
      profiles.set(profile.id, profile);
      return Promise.resolve();
    },
    remove(id) {
      profiles.delete(id);
      if (activeId === id) {
        activeId = null;
      }
      return Promise.resolve();
    },
    setActive(id) {
      if (!profiles.has(id)) {
        return Promise.reject(new UnknownProfileError(id));
      }
      activeId = id;
      return Promise.resolve();
    },
    getActive() {
      return Promise.resolve(activeId === null ? undefined : profiles.get(activeId));
    },
  };
}

/** localStorage-backed {@link ProfileStore}; falls back to memory off-browser. */
export function webLocalStorageStore(options: WebLocalStorageStoreOptions = {}): ProfileStore {
  const storage = options.storage ?? defaultStorage();
  const profilesKey = options.profilesKey ?? PROFILES_KEY;
  const activeKey = options.activeKey ?? ACTIVE_PROFILE_KEY;

  function readProfiles(): ServerProfile[] {
    const raw = storage.getItem(profilesKey);
    if (raw === null) {
      return [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(sanitizeStoredProfile)
      .filter((profile): profile is ServerProfile => profile !== null);
  }

  function writeProfiles(profiles: readonly ServerProfile[]): void {
    storage.setItem(profilesKey, JSON.stringify(profiles));
  }

  function readActiveId(): string | null {
    return storage.getItem(activeKey);
  }

  return {
    list() {
      return Promise.resolve(readProfiles());
    },
    get(id) {
      return Promise.resolve(readProfiles().find((profile) => profile.id === id));
    },
    add(profile) {
      const profiles = readProfiles().filter((existing) => existing.id !== profile.id);
      profiles.push(profile);
      writeProfiles(profiles);
      return Promise.resolve();
    },
    remove(id) {
      writeProfiles(readProfiles().filter((profile) => profile.id !== id));
      if (readActiveId() === id) {
        storage.removeItem(activeKey);
      }
      return Promise.resolve();
    },
    setActive(id) {
      const exists = readProfiles().some((profile) => profile.id === id);
      if (!exists) {
        return Promise.reject(new UnknownProfileError(id));
      }
      storage.setItem(activeKey, id);
      return Promise.resolve();
    },
    getActive() {
      const id = readActiveId();
      if (id === null) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(readProfiles().find((profile) => profile.id === id));
    },
  };
}
