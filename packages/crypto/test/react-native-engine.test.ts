import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createReactNativeMlsEngine,
  installReactNativeCrypto,
  isReactNativeCryptoSufficient,
  MlsEngineError,
  memoryKeyStore,
  probeReactNativeCrypto,
  REACT_NATIVE_MLS_UNAVAILABLE,
  type ReactNativeQuickCrypto,
} from "../src/index.js";
import { runTwoDeviceScenario } from "./scenario.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Simulates Hermes/Expo (a `crypto` with `getRandomValues` but no `subtle`) and
 * returns a quick-crypto stand-in whose `install()` restores the real WebCrypto,
 * exactly like `react-native-quick-crypto`'s `install()` patches `globalThis`.
 */
function hermesThenQuickCrypto(): {
  quickCrypto: ReactNativeQuickCrypto;
  install: ReturnType<typeof vi.fn>;
} {
  const real = globalThis.crypto;
  vi.stubGlobal("crypto", {
    getRandomValues: (array: Uint8Array) => real.getRandomValues(array),
  });
  const install = vi.fn(() => vi.stubGlobal("crypto", real));
  return { quickCrypto: { install }, install };
}

describe("installReactNativeCrypto", () => {
  it("throws a typed not-implemented error when the module is absent", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint8Array) => real.getRandomValues(array),
    });
    try {
      installReactNativeCrypto({});
      throw new Error("expected installReactNativeCrypto to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MlsEngineError);
      expect((error as MlsEngineError).code).toBe("not-implemented");
      expect((error as MlsEngineError).message).toBe(REACT_NATIVE_MLS_UNAVAILABLE);
    }
  });

  it("installs only when crypto.subtle is missing", () => {
    const install = vi.fn();
    installReactNativeCrypto({ install });
    expect(install).not.toHaveBeenCalled();

    const { quickCrypto, install: missing } = hermesThenQuickCrypto();
    installReactNativeCrypto(quickCrypto);
    expect(missing).toHaveBeenCalledTimes(1);
    expect(globalThis.crypto.subtle).toBeDefined();
  });
});

describe("probeReactNativeCrypto", () => {
  it("reports every ts-mls / @hpke primitive as supported on the platform WebCrypto", async () => {
    const report = await probeReactNativeCrypto(globalThis.crypto);
    expect(report).toEqual({
      subtle: true,
      randomValues: true,
      x25519: true,
      ed25519: true,
      hkdf: true,
      hmac: true,
      aesGcm: true,
      digest: true,
    });
    expect(isReactNativeCryptoSufficient(report)).toBe(true);
  });

  it("reports nothing supported without a subtle", async () => {
    const report = await probeReactNativeCrypto({} as Crypto);
    expect(report.subtle).toBe(false);
    expect(isReactNativeCryptoSufficient(report)).toBe(false);
  });
});

describe("createReactNativeMlsEngine", () => {
  it("installs the polyfill then runs the two-device scenario end to end", async () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint8Array) => real.getRandomValues(array),
    });
    const install = vi.fn(() => vi.stubGlobal("crypto", real));
    const quickCrypto: ReactNativeQuickCrypto = { install };
    // The app installs at startup, before the key store captures `crypto`.
    installReactNativeCrypto(quickCrypto);
    expect(install).toHaveBeenCalledTimes(1);

    const creator = createReactNativeMlsEngine({ keyStore: memoryKeyStore(), quickCrypto });
    const joiner = createReactNativeMlsEngine({ keyStore: memoryKeyStore(), quickCrypto });
    expect(install).toHaveBeenCalledTimes(1);

    const transcript = await runTwoDeviceScenario(creator, joiner);

    expect(transcript.epochAfterCreate).toBe("0");
    expect(transcript.epochAfterAdd).toBe("1");
    expect(transcript.joinedEpoch).toBe("1");
    expect(transcript.epochAfterRemove).toBe("2");
    expect(transcript.memberLeafIndexes).toEqual([0, 1]);
    expect(transcript.bobDecryptsAlice).toBe("hello joiner");
    expect(transcript.aliceDecryptsBob).toBe("hello creator");
    expect(transcript.postRemovalDecryptFailed).toBe(true);
  });

  it("throws instead of returning an engine that cannot encrypt", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint8Array) => real.getRandomValues(array),
    });
    expect(() =>
      createReactNativeMlsEngine({ keyStore: memoryKeyStore(), quickCrypto: {} }),
    ).toThrow(MlsEngineError);
  });
});
