import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  createEncryptedKeyStore,
  type EncryptedKeyStoreBackend,
  indexedDbKeyStore,
  MlsEngineError,
  memoryKeyStore,
} from "../src/index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

interface RecordingBackend {
  backend: EncryptedKeyStoreBackend;
  values: Map<string, Uint8Array>;
  wrappingKey(): CryptoKey | undefined;
}

function recordingBackend(): RecordingBackend {
  const values = new Map<string, Uint8Array>();
  let wrappingKey: CryptoKey | undefined;
  return {
    values,
    wrappingKey: () => wrappingKey,
    backend: {
      readValue: async (key) => values.get(key),
      writeValue: async (key, value) => {
        values.set(key, value);
      },
      deleteValue: async (key) => {
        values.delete(key);
      },
      listKeys: async (prefix) =>
        [...values.keys()].filter((key) => !prefix || key.startsWith(prefix)).sort(),
      readWrappingKey: async () => wrappingKey,
      writeWrappingKey: async (key) => {
        wrappingKey = key;
      },
    },
  };
}

describe("memoryKeyStore", () => {
  it("round-trips, lists and deletes records", async () => {
    const store = memoryKeyStore();
    await store.set("a/one", bytes("value-1"));
    await store.set("a/two", bytes("value-2"));
    await store.set("b/three", bytes("value-3"));

    expect(await store.get("a/one")).toEqual(bytes("value-1"));
    expect(await store.get("missing")).toBeUndefined();
    expect(await store.keys()).toEqual(["a/one", "a/two", "b/three"]);
    expect(await store.keys("a/")).toEqual(["a/one", "a/two"]);

    await store.delete("a/one");
    expect(await store.get("a/one")).toBeUndefined();
  });
});

describe("createEncryptedKeyStore", () => {
  it("never writes plaintext records and stores a non-extractable wrapping key", async () => {
    const recording = recordingBackend();
    const store = createEncryptedKeyStore(recording.backend);
    const plaintext = bytes("private-signature-key-material");
    await store.set("aulora/mls/identity", plaintext);

    const atRest = recording.values.get("aulora/mls/identity");
    if (!atRest) {
      throw new Error("record was not written");
    }
    expect(atRest).not.toEqual(plaintext);
    expect(decoder.decode(atRest)).not.toContain("private-signature-key-material");
    expect(await store.get("aulora/mls/identity")).toEqual(plaintext);

    const wrappingKey = recording.wrappingKey();
    expect(wrappingKey).toBeDefined();
    expect(wrappingKey?.extractable).toBe(false);
    expect(wrappingKey?.algorithm.name).toBe("AES-GCM");
  });

  it("rejects a tampered record", async () => {
    const recording = recordingBackend();
    const store = createEncryptedKeyStore(recording.backend);
    await store.set("group/one", bytes("state"));
    const record = recording.values.get("group/one");
    if (!record) {
      throw new Error("record was not written");
    }
    record[record.length - 1] = (record[record.length - 1] ?? 0) ^ 0xff;

    await expect(store.get("group/one")).rejects.toBeInstanceOf(MlsEngineError);
  });
});

describe("indexedDbKeyStore (fake-indexeddb)", () => {
  it("round-trips encrypted records through IndexedDB", async () => {
    const store = indexedDbKeyStore({ databaseName: `aulora-crypto-test-${Date.now()}` });
    await store.set("aulora/mls/group/abc", bytes("group-state-bytes"));
    expect(await store.get("aulora/mls/group/abc")).toEqual(bytes("group-state-bytes"));

    expect(await store.keys("aulora/mls/group/")).toEqual(["aulora/mls/group/abc"]);

    await store.delete("aulora/mls/group/abc");
    expect(await store.get("aulora/mls/group/abc")).toBeUndefined();
  });
});
