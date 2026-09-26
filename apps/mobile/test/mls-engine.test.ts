import { memoryKeyStore } from "@aulora/crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const { install } = vi.hoisted(() => ({ install: vi.fn() }));
vi.mock("react-native-quick-crypto", () => ({
  install,
  subtle: undefined,
  getRandomValues: undefined,
}));

import { ensureReactNativeCrypto, mobileMlsEngine } from "../src/lib/mls-engine";

afterEach(() => {
  vi.unstubAllGlobals();
  install.mockReset();
});

/** Simulates Hermes (getRandomValues but no subtle) with a native install. */
function hermesThenInstall(): void {
  const real = globalThis.crypto;
  vi.stubGlobal("crypto", {
    getRandomValues: (array: Uint8Array) => real.getRandomValues(array),
  });
  install.mockImplementation(() => vi.stubGlobal("crypto", real));
}

describe("ensureReactNativeCrypto", () => {
  it("installs the polyfill once across repeated calls", () => {
    hermesThenInstall();
    ensureReactNativeCrypto();
    ensureReactNativeCrypto();
    ensureReactNativeCrypto();
    expect(install).toHaveBeenCalledTimes(1);
    expect(globalThis.crypto.subtle).toBeDefined();
  });

  it("does not reinstall when subtle is already present", () => {
    ensureReactNativeCrypto();
    expect(install).not.toHaveBeenCalled();
  });
});

describe("mobileMlsEngine", () => {
  it("returns a full MlsEngine over the device key store", () => {
    const engine = mobileMlsEngine(memoryKeyStore());
    for (const method of [
      "generateKeyPackage",
      "createGroup",
      "joinFromWelcome",
      "addMembers",
      "removeMembers",
      "processCommit",
      "encrypt",
      "decrypt",
      "epoch",
      "members",
      "exportState",
      "importState",
    ] as const) {
      expect(typeof engine[method]).toBe("function");
    }
  });

  it("throws instead of building an engine without the native crypto", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint8Array) => real.getRandomValues(array),
    });
    expect(() => mobileMlsEngine(memoryKeyStore())).toThrow(/react-native-quick-crypto/);
  });
});
