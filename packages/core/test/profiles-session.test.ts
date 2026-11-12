import { describe, expect, it } from "vitest";
import {
  activeProfileOf,
  addProfileToStore,
  createMemoryProfileStore,
  type ProfileStore,
  readProfileSnapshot,
  readProfileSnapshotSafely,
  removeProfileFromStore,
} from "../src/profiles";
import type { WellKnown } from "../src/well-known";

const wellKnown: WellKnown = {
  name: "Acme Chat",
  version: "0.1.0",
  apiVersion: 1,
  convexUrl: "https://convex.acme.com",
  siteUrl: "https://chat.acme.com",
  iconSeed: "aulora:server:acme",
  auth: { local: { enabled: true, signup: false }, providers: [] },
};

describe("profile session helpers", () => {
  it("reads the saved profiles and the active one together", async () => {
    const store = createMemoryProfileStore();
    const profile = await addProfileToStore(store, "chat.acme.com", wellKnown);
    const snapshot = await readProfileSnapshot(store);
    expect(snapshot.profiles.map((entry) => entry.id)).toEqual([profile.id]);
    expect(snapshot.activeId).toBe(profile.id);
    expect(snapshot.activeProfile).toEqual(profile);
  });

  it("finds the active profile by id", () => {
    const profile = { id: "https://chat.acme.com" } as never;
    expect(activeProfileOf([profile], "https://chat.acme.com")).toBe(profile);
    expect(activeProfileOf([profile], "https://other.example")).toBeUndefined();
  });

  it("treats a failed read as no saved profiles", async () => {
    const failing: ProfileStore = {
      list: () => Promise.reject(new Error("locked")),
      get: () => Promise.resolve(undefined),
      add: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      setActive: () => Promise.resolve(),
      getActive: () => Promise.resolve(undefined),
    };
    await expect(readProfileSnapshotSafely(failing)).resolves.toEqual({
      profiles: [],
      activeId: undefined,
      activeProfile: undefined,
    });
    await expect(readProfileSnapshot(failing)).rejects.toThrow("locked");
  });

  it("removes a profile from the store", async () => {
    const store = createMemoryProfileStore();
    const profile = await addProfileToStore(store, "chat.acme.com", wellKnown);
    await removeProfileFromStore(store, profile.id);
    await expect(readProfileSnapshot(store)).resolves.toEqual({
      profiles: [],
      activeId: undefined,
      activeProfile: undefined,
    });
  });
});
