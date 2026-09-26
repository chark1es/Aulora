import { createServerProfile, type ServerProfile, type WellKnown } from "@aulora/core";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_PROFILE_KEY,
  type AsyncKeyValueStore,
  createMobileProfileStore,
  PROFILES_KEY,
  sanitizeProfile,
} from "../src/lib/profiles";

const wellKnown: WellKnown = {
  name: "Acme",
  version: "0.4.0",
  apiVersion: 1,
  convexUrl: "https://convex.acme.com",
  siteUrl: "https://chat.acme.com",
  iconSeed: "aulora:server:acme",
  auth: {
    local: { enabled: true, signup: true },
    providers: [{ id: "github", type: "oauth", displayName: "GitHub" }],
  },
};

function profile(): ServerProfile {
  return createServerProfile("chat.acme.com", wellKnown, 1000);
}

function memoryStore(): { storage: AsyncKeyValueStore; map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem: async (key) => map.get(key) ?? null,
      setItem: async (key, value) => {
        map.set(key, value);
      },
      removeItem: async (key) => {
        map.delete(key);
      },
    },
  };
}

describe("createMobileProfileStore", () => {
  it("adds, lists, activates and removes profiles", async () => {
    const { storage } = memoryStore();
    const store = createMobileProfileStore(storage);
    const server = profile();

    expect(await store.list()).toEqual([]);
    await store.add(server);
    expect(await store.list()).toHaveLength(1);
    expect(await store.get(server.id)).toEqual(server);

    await store.setActive(server.id);
    expect(await store.getActive()).toEqual(server);

    await store.remove(server.id);
    expect(await store.list()).toEqual([]);
    expect(await store.getActive()).toBeUndefined();
  });

  it("rejects activation of an unknown profile", async () => {
    const { storage } = memoryStore();
    const store = createMobileProfileStore(storage);
    await expect(store.setActive("https://nope.example")).rejects.toThrow();
  });

  it("drops corrupt entries instead of returning them", async () => {
    const { storage, map } = memoryStore();
    map.set(PROFILES_KEY, JSON.stringify([{ id: "x" }, null, 7]));
    map.set(ACTIVE_PROFILE_KEY, "x");
    const store = createMobileProfileStore(storage);
    expect(await store.list()).toEqual([]);
    expect(await store.getActive()).toBeUndefined();
  });
});

describe("sanitizeProfile", () => {
  it("keeps a well-formed profile", () => {
    expect(sanitizeProfile(profile())).toEqual(profile());
  });

  it("drops profiles missing required fields or with a bad auth block", () => {
    expect(sanitizeProfile({ id: "x" })).toBeNull();
    expect(sanitizeProfile({ ...profile(), auth: {} })).toBeNull();
    expect(sanitizeProfile({ ...profile(), auth: { local: {}, providers: [] } })).toEqual({
      ...profile(),
      auth: { local: { enabled: false, signup: false }, providers: [] },
    });
  });

  it("filters malformed providers but keeps valid ones", () => {
    const clean = sanitizeProfile({
      ...profile(),
      auth: {
        local: { enabled: true, signup: false },
        providers: [{ id: "nope" }, { id: "ok", type: "oauth", displayName: "Okta" }, 9],
      },
    });
    expect(clean?.auth.providers).toEqual([{ id: "ok", type: "oauth", displayName: "Okta" }]);
  });
});
