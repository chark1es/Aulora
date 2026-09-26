import { describe, expect, it, vi } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  EXPO_SECURE_STORE_PREFIX,
  type ExpoSecureStoreLike,
  expoSecureStoreKeyStore,
  MlsEngineError,
  TAURI_KEYSTORE_PREFIX,
  type TauriKeychainTransport,
  tauriKeychainKeyStore,
  tauriKeychainTransport,
} from "../src/index.js";

const encoder = new TextEncoder();

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

interface FakeTransport {
  transport: TauriKeychainTransport;
  entries: Map<string, string>;
}

function fakeTransport(): FakeTransport {
  const entries = new Map<string, string>();
  return {
    entries,
    transport: {
      read: async (key) => entries.get(key) ?? null,
      write: async (key, value) => {
        entries.set(key, value);
      },
      remove: async (key) => {
        entries.delete(key);
      },
      list: async (prefix) =>
        [...entries.keys()].filter((key) => !prefix || key.startsWith(prefix)).sort(),
    },
  };
}

describe("tauriKeychainKeyStore", () => {
  it("round-trips, scopes and deletes records through the transport", async () => {
    const fake = fakeTransport();
    const store = tauriKeychainKeyStore({ transport: fake.transport });

    await store.set("device/identity", bytes("identity-material"));
    await store.set("group/abc", bytes("group-state"));
    await store.set("other/thing", bytes("other"));

    // Records are namespaced, so unrelated keychain entries are invisible.
    expect(await store.get("device/identity")).toEqual(bytes("identity-material"));
    expect(await store.get("missing")).toBeUndefined();
    expect(await store.keys()).toEqual(["device/identity", "group/abc", "other/thing"]);
    expect(await store.keys("group/")).toEqual(["group/abc"]);
    expect([...fake.entries.keys()]).toContain(`${TAURI_KEYSTORE_PREFIX}device/identity`);

    await store.delete("device/identity");
    expect(await store.get("device/identity")).toBeUndefined();
    expect(fake.entries.has(`${TAURI_KEYSTORE_PREFIX}device/identity`)).toBe(false);
  });

  it("writes base64, never raw bytes, to the OS keychain", async () => {
    const fake = fakeTransport();
    const store = tauriKeychainKeyStore({ transport: fake.transport });
    const value = bytes("private-signature-key-material");
    await store.set("identity", value);

    const atRest = fake.entries.get(`${TAURI_KEYSTORE_PREFIX}identity`);
    expect(atRest).toBe(bytesToBase64(value));
    expect(base64ToBytes(atRest ?? "")).toEqual(value);
  });

  it("allows a custom prefix", async () => {
    const fake = fakeTransport();
    const store = tauriKeychainKeyStore({ transport: fake.transport, prefix: "aulora/test/" });
    await store.set("one", bytes("1"));
    expect(await store.keys()).toEqual(["one"]);
    expect([...fake.entries.keys()]).toEqual(["aulora/test/one"]);
  });

  it("throws a typed error without a Tauri runtime or injected transport", () => {
    const globalWithTauri = globalThis as { __TAURI__?: unknown };
    const saved = globalWithTauri.__TAURI__;
    delete globalWithTauri.__TAURI__;
    try {
      expect(() => tauriKeychainKeyStore()).toThrow(MlsEngineError);
    } finally {
      if (saved !== undefined) {
        globalWithTauri.__TAURI__ = saved;
      }
    }
  });
});

describe("tauriKeychainTransport", () => {
  it("maps the four keychain commands and normalizes the result shape", async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "keychain_get") {
        return "ZGF0YQ==";
      }
      if (command === "keychain_list") {
        return ["aulora/mls/a", 7, "aulora/mls/b"];
      }
      void args;
      return null;
    });
    const transport = tauriKeychainTransport(invoke);

    expect(await transport.read("k")).toBe("ZGF0YQ==");
    await transport.write("k", "ZGF0YQ==");
    await transport.remove("k");
    expect(await transport.list("aulora/mls/")).toEqual(["aulora/mls/a", "aulora/mls/b"]);
    expect(invoke).toHaveBeenCalledWith("keychain_set", { key: "k", value: "ZGF0YQ==" });
    expect(invoke).toHaveBeenCalledWith("keychain_delete", { key: "k" });
  });
});

describe("expoSecureStoreKeyStore", () => {
  function fakeSecureStore(): { store: ExpoSecureStoreLike; entries: Map<string, string> } {
    const entries = new Map<string, string>();
    return {
      entries,
      store: {
        getItemAsync: async (key) => entries.get(key) ?? null,
        setItemAsync: async (key, value) => {
          entries.set(key, value);
        },
        deleteItemAsync: async (key) => {
          entries.delete(key);
        },
      },
    };
  }

  it("throws a typed error when no expo-secure-store module is injected", () => {
    expect(() => expoSecureStoreKeyStore()).toThrow(MlsEngineError);
  });

  it("round-trips, scopes and deletes records through the injected store", async () => {
    const fake = fakeSecureStore();
    const store = expoSecureStoreKeyStore({ secureStore: fake.store });

    await store.set("identity", bytes("private-key-material"));
    await store.set("group/abc", bytes("group-state"));

    expect(await store.get("identity")).toEqual(bytes("private-key-material"));
    expect(await store.get("missing")).toBeUndefined();
    expect(await store.keys()).toEqual(["group/abc", "identity"]);
    expect(await store.keys("group/")).toEqual(["group/abc"]);
    expect([...fake.entries.keys()].some((key) => key.startsWith(EXPO_SECURE_STORE_PREFIX))).toBe(
      true,
    );

    await store.delete("identity");
    expect(await store.get("identity")).toBeUndefined();
    expect(await store.keys()).toEqual(["group/abc"]);
  });

  it("chunks values larger than one SecureStore entry", async () => {
    const fake = fakeSecureStore();
    const store = expoSecureStoreKeyStore({ secureStore: fake.store });
    const large = new Uint8Array(5000).fill(7);

    await store.set("group/large", large);
    expect(await store.get("group/large")).toEqual(large);

    const chunkEntries = [...fake.entries.keys()].filter((key) => key.includes("#"));
    expect(chunkEntries.length).toBeGreaterThan(1);
    // Every chunk stays under the SecureStore value cap once base64-decoded.
    for (const key of chunkEntries) {
      expect((fake.entries.get(key) ?? "").length).toBeLessThanOrEqual(1800);
    }
  });

  it("allows a custom prefix", async () => {
    const fake = fakeSecureStore();
    const store = expoSecureStoreKeyStore({ secureStore: fake.store, prefix: "aulora/test." });
    await store.set("one", bytes("1"));
    expect(await store.keys()).toEqual(["one"]);
    expect([...fake.entries.keys()].every((key) => key.startsWith("aulora/test."))).toBe(true);
  });
});
