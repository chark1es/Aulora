import { describe, expect, it } from "vitest";
import {
  clearSessionToken,
  isCrossOrigin,
  readSessionToken,
  type TokenStorage,
  writeSessionToken,
} from "./session-token";

function memoryStorage(): TokenStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe("session token", () => {
  it("round-trips per server origin", () => {
    const storage = memoryStorage();
    writeSessionToken("https://chat.acme.com/", "abc", storage);
    expect(readSessionToken("https://chat.acme.com", storage)).toBe("abc");
    expect(readSessionToken("https://other.acme.com", storage)).toBeNull();
  });

  it("clears the stored token", () => {
    const storage = memoryStorage();
    writeSessionToken("https://chat.acme.com", "abc", storage);
    clearSessionToken("https://chat.acme.com", storage);
    expect(readSessionToken("https://chat.acme.com", storage)).toBeNull();
  });

  it("does not throw without storage", () => {
    expect(() => writeSessionToken("https://chat.acme.com", "abc", null)).not.toThrow();
    expect(readSessionToken("https://chat.acme.com", null)).toBeNull();
  });

  it("detects a cross-origin server", () => {
    expect(isCrossOrigin("https://chat.acme.com", "tauri://localhost")).toBe(true);
    expect(isCrossOrigin("https://chat.acme.com", "https://chat.acme.com")).toBe(false);
  });
});
