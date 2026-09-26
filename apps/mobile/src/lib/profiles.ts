import type { ProfileStore, ServerProfile, WellKnownAuth, WellKnownProvider } from "@aulora/core";

/**
 * Async key/value storage the mobile profile store is built on (AsyncStorage).
 * Kept structural so the store is unit-testable without React Native.
 */
export interface AsyncKeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const PROFILES_KEY = "aulora.profiles.v1";
export const ACTIVE_PROFILE_KEY = "aulora.activeProfile.v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sanitizeProvider(value: unknown): WellKnownProvider | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  const displayName = readString(value.displayName);
  if (id === null || displayName === null) {
    return null;
  }
  if (value.type === "oauth") {
    return { id, type: "oauth", displayName };
  }
  if (value.type === "oidc") {
    const issuer = readString(value.issuer);
    const discoveryUrl = readString(value.discoveryUrl);
    const clientId = readString(value.clientId);
    const scopes = Array.isArray(value.scopes)
      ? value.scopes.filter((scope): scope is string => typeof scope === "string")
      : null;
    if (issuer === null || discoveryUrl === null || clientId === null || scopes === null) {
      return null;
    }
    return { id, type: "oidc", displayName, issuer, discoveryUrl, clientId, scopes };
  }
  return null;
}

/**
 * Validates one stored profile. Never trusts the store: a corrupted or
 * hand-edited document must not reach the auth/Convex wiring.
 */
export function sanitizeProfile(value: unknown): ServerProfile | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  const baseUrl = readString(value.baseUrl);
  const name = readString(value.name);
  const iconSeed = readString(value.iconSeed);
  const version = readString(value.version);
  const convexUrl = readString(value.convexUrl);
  const siteUrl = readString(value.siteUrl);
  const apiVersion = typeof value.apiVersion === "number" ? value.apiVersion : null;
  const addedAt = typeof value.addedAt === "number" ? value.addedAt : 0;
  const auth = value.auth;
  if (
    id === null ||
    baseUrl === null ||
    name === null ||
    iconSeed === null ||
    version === null ||
    convexUrl === null ||
    siteUrl === null ||
    apiVersion === null ||
    !isRecord(auth) ||
    !isRecord(auth.local) ||
    !Array.isArray(auth.providers)
  ) {
    return null;
  }
  const authBlock: WellKnownAuth = {
    local: {
      enabled: auth.local.enabled === true,
      signup: auth.local.signup === true,
    },
    providers: auth.providers
      .map(sanitizeProvider)
      .filter((provider): provider is WellKnownProvider => provider !== null),
  };
  return {
    id,
    baseUrl,
    name,
    iconSeed,
    version,
    apiVersion,
    convexUrl,
    siteUrl,
    auth: authBlock,
    addedAt,
  };
}

/** AsyncStorage-backed {@link ProfileStore} for iOS/Android. */
export function createMobileProfileStore(storage: AsyncKeyValueStore): ProfileStore {
  async function readProfiles(): Promise<ServerProfile[]> {
    const raw = await storage.getItem(PROFILES_KEY);
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
      .map(sanitizeProfile)
      .filter((profile): profile is ServerProfile => profile !== null);
  }

  async function writeProfiles(profiles: readonly ServerProfile[]): Promise<void> {
    await storage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  }

  return {
    async list() {
      return readProfiles();
    },
    async get(id) {
      return (await readProfiles()).find((profile) => profile.id === id);
    },
    async add(profile) {
      const profiles = (await readProfiles()).filter((existing) => existing.id !== profile.id);
      profiles.push(profile);
      await writeProfiles(profiles);
    },
    async remove(id) {
      await writeProfiles((await readProfiles()).filter((profile) => profile.id !== id));
      if ((await storage.getItem(ACTIVE_PROFILE_KEY)) === id) {
        await storage.removeItem(ACTIVE_PROFILE_KEY);
      }
    },
    async setActive(id) {
      const exists = (await readProfiles()).some((profile) => profile.id === id);
      if (!exists) {
        throw new Error(`Unknown server profile: ${id}`);
      }
      await storage.setItem(ACTIVE_PROFILE_KEY, id);
    },
    async getActive() {
      const id = await storage.getItem(ACTIVE_PROFILE_KEY);
      if (id === null) {
        return undefined;
      }
      return (await readProfiles()).find((profile) => profile.id === id);
    },
  };
}
