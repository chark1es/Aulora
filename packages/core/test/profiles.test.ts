import { describe, expect, it } from "vitest";
import {
  createMemoryProfileStore,
  createServerProfile,
  type ServerProfile,
  type StorageLike,
  UnknownProfileError,
  webLocalStorageStore,
} from "../src/profiles";
import type { WellKnown } from "../src/well-known";

const wellKnown: WellKnown = {
  name: "Acme Chat",
  version: "0.1.0",
  apiVersion: 1,
  convexUrl: "https://convex.acme.com",
  siteUrl: "https://chat.acme.com",
  iconSeed: "aulora:server:acme",
  auth: {
    local: { enabled: true, signup: false },
    providers: [
      { id: "github", type: "oauth", displayName: "GitHub" },
      {
        id: "keycloak",
        type: "oidc",
        displayName: "Keycloak",
        issuer: "https://idp.acme.com/realms/acme",
        discoveryUrl: "https://idp.acme.com/realms/acme/.well-known/openid-configuration",
        clientId: "aulora",
        scopes: ["openid", "email"],
      },
    ],
  },
};

function createFakeStorage(): StorageLike {
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

describe("createServerProfile", () => {
  it("stores the canonical base URL and public fields only", () => {
    const profile = createServerProfile("chat.acme.com/", wellKnown, 42);
    expect(profile.baseUrl).toBe("https://chat.acme.com");
    expect(profile.id).toBe("https://chat.acme.com");
    expect(profile.name).toBe("Acme Chat");
    expect(profile.convexUrl).toBe("https://convex.acme.com");
    expect(profile.iconSeed).toBe("aulora:server:acme");
    expect(profile.apiVersion).toBe(1);
    expect(profile.addedAt).toBe(42);
    expect(JSON.stringify(profile)).not.toContain("Secret");
  });

  it("deep-copies auth so later mutation cannot leak into a profile", () => {
    const source = JSON.parse(JSON.stringify(wellKnown)) as WellKnown;
    const profile = createServerProfile("chat.acme.com", source);
    (source.auth.providers as unknown[]).length = 0;
    expect(profile.auth.providers).toHaveLength(2);
  });

  it("drops secret-shaped fields even if a caller bypasses the validator", () => {
    const unvalidated = {
      ...wellKnown,
      auth: {
        ...wellKnown.auth,
        providers: [
          {
            id: "keycloak",
            type: "oidc",
            displayName: "Keycloak",
            issuer: "https://idp.acme.com",
            discoveryUrl: "https://idp.acme.com/.well-known/openid-configuration",
            clientId: "aulora",
            scopes: ["openid"],
            clientSecret: "should-not-survive",
          },
        ],
      },
    } as unknown as WellKnown;
    const profile = createServerProfile("chat.acme.com", unvalidated);
    expect(JSON.stringify(profile)).not.toContain("should-not-survive");
    expect(JSON.stringify(profile)).not.toContain("clientSecret");
  });
});

describe("createServerProfile loopback resolution", () => {
  const localWellKnown: WellKnown = {
    ...wellKnown,
    convexUrl: "http://localhost:3210",
    siteUrl: "http://localhost:8080",
  };

  it("serves Convex from the Tailscale origin the server was reached on", () => {
    const profile = createServerProfile("http://100.64.0.10:8080", localWellKnown);
    expect(profile.baseUrl).toBe("http://100.64.0.10:8080");
    expect(profile.convexUrl).toBe("http://100.64.0.10:8080");
    expect(profile.siteUrl).toBe("http://100.64.0.10:8080");
  });

  it("serves Convex from the LAN origin the server was reached on", () => {
    const profile = createServerProfile("http://192.168.1.20:8080", localWellKnown);
    expect(profile.convexUrl).toBe("http://192.168.1.20:8080");
    expect(profile.siteUrl).toBe("http://192.168.1.20:8080");
  });

  it("serves Convex from localhost when the base is localhost", () => {
    const profile = createServerProfile("http://localhost:8080", localWellKnown);
    expect(profile.convexUrl).toBe("http://localhost:8080");
    expect(profile.siteUrl).toBe("http://localhost:8080");
  });

  it("serves Convex from an HTTPS tunnel origin", () => {
    const profile = createServerProfile("https://cool-wren.slim.show", localWellKnown);
    expect(profile.convexUrl).toBe("https://cool-wren.slim.show");
  });

  it("leaves a public https well-known document untouched", () => {
    const profile = createServerProfile("https://chat.acme.com", wellKnown);
    expect(profile.convexUrl).toBe("https://convex.acme.com");
    expect(profile.siteUrl).toBe("https://chat.acme.com");
  });
});

describe("createMemoryProfileStore", () => {
  const profile = createServerProfile("chat.acme.com", wellKnown, 1);

  it("supports the full store lifecycle", async () => {
    const store = createMemoryProfileStore();
    expect(await store.list()).toEqual([]);
    expect(await store.get(profile.id)).toBeUndefined();
    expect(await store.getActive()).toBeUndefined();

    await store.add(profile);
    expect(await store.list()).toEqual([profile]);
    expect(await store.get(profile.id)).toEqual(profile);

    await store.setActive(profile.id);
    expect(await store.getActive()).toEqual(profile);

    await store.remove(profile.id);
    expect(await store.list()).toEqual([]);
    expect(await store.get(profile.id)).toBeUndefined();
    expect(await store.getActive()).toBeUndefined();
  });

  it("rejects activating an unknown profile", async () => {
    const store = createMemoryProfileStore();
    await expect(store.setActive("https://nope.example")).rejects.toBeInstanceOf(
      UnknownProfileError,
    );
  });

  it("upserts by id instead of duplicating", async () => {
    const store = createMemoryProfileStore();
    await store.add(profile);
    await store.add({ ...profile, name: "Renamed" });
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("Renamed");
  });
});

describe("webLocalStorageStore", () => {
  const profile = createServerProfile("chat.acme.com", wellKnown, 1);

  it("persists profiles and the active id across instances", async () => {
    const storage = createFakeStorage();
    const first = webLocalStorageStore({ storage });
    await first.add(profile);
    await first.setActive(profile.id);

    const second = webLocalStorageStore({ storage });
    expect(await second.list()).toEqual([profile]);
    expect((await second.getActive())?.id).toBe(profile.id);

    await second.remove(profile.id);
    expect(await second.getActive()).toBeUndefined();
    expect(await webLocalStorageStore({ storage }).list()).toEqual([]);
  });

  it("rejects activating an unknown profile", async () => {
    const store = webLocalStorageStore({ storage: createFakeStorage() });
    await expect(store.setActive(profile.id)).rejects.toBeInstanceOf(UnknownProfileError);
  });

  it("survives corrupt storage", async () => {
    const storage = createFakeStorage();
    storage.setItem("aulora.profiles.v1", "not-json");
    const store = webLocalStorageStore({ storage });
    expect(await store.list()).toEqual([]);

    storage.setItem("aulora.profiles.v1", JSON.stringify({ nope: true }));
    expect(await store.list()).toEqual([]);
  });

  it("sanitizes secret-shaped fields out of persisted profiles", async () => {
    const storage = createFakeStorage();
    storage.setItem(
      "aulora.profiles.v1",
      JSON.stringify([{ ...profile, adminKey: "should-not-survive", token: "nor-this" }]),
    );
    const store = webLocalStorageStore({ storage });
    const [stored] = await store.list();
    expect(stored?.id).toBe(profile.id);
    expect(JSON.stringify(stored)).not.toContain("should-not-survive");
    expect(JSON.stringify(stored)).not.toContain("nor-this");
  });

  it("falls back to memory when localStorage is missing", async () => {
    const store = webLocalStorageStore();
    const bare: ServerProfile = { ...profile };
    await store.add(bare);
    expect(await store.get(bare.id)).toEqual(bare);
  });
});
