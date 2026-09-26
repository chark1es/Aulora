import { describe, expect, it, vi } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
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
  it("is still an explicit Phase 5 stub", () => {
    expect(() => expoSecureStoreKeyStore()).toThrow(MlsEngineError);
  });
});
