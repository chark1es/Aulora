import { describe, expect, it, vi } from "vitest";
import {
  createNativeMlsEngine,
  MlsEngineError,
  NATIVE_MLS_TODO,
  type NativeMlsBridge,
} from "../src/index.js";

const encoder = new TextEncoder();

function fakeBridge(): NativeMlsBridge {
  return {
    generateKeyPackage: vi.fn(async () => encoder.encode("key-package")),
    createGroup: vi.fn(async () => undefined),
    joinFromWelcome: vi.fn(async () => undefined),
    addMembers: vi.fn(async () => ({
      commit: encoder.encode("commit"),
      welcome: encoder.encode("welcome"),
    })),
    removeMembers: vi.fn(async () => encoder.encode("remove")),
    processCommit: vi.fn(async () => undefined),
    encrypt: vi.fn(async (plaintext) => plaintext),
    decrypt: vi.fn(async (ciphertext) => ciphertext),
    epoch: vi.fn(async () => 4n),
    members: vi.fn(async () => [{ leafIndex: 0, identity: "aulora:device:abc" }]),
    exportState: vi.fn(async () => encoder.encode("state")),
    importState: vi.fn(async () => undefined),
  };
}

describe("createNativeMlsEngine", () => {
  it("falls through to a typed not-implemented error without an OpenMLS bridge", () => {
    try {
      createNativeMlsEngine();
      throw new Error("expected createNativeMlsEngine to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MlsEngineError);
      expect((error as MlsEngineError).code).toBe("not-implemented");
      expect((error as MlsEngineError).message).toContain("OpenMLS");
      expect(NATIVE_MLS_TODO).toContain("crypto.subtle");
    }
  });

  it("delegates every MlsEngine operation to the injected bridge", async () => {
    const bridge = fakeBridge();
    const engine = createNativeMlsEngine({ bridge });

    expect(await engine.generateKeyPackage()).toEqual(encoder.encode("key-package"));

    await engine.createGroup(encoder.encode("g"), encoder.encode("kp"));
    expect(bridge.createGroup).toHaveBeenCalledWith(encoder.encode("g"), encoder.encode("kp"));

    await engine.joinFromWelcome(encoder.encode("w"), encoder.encode("kp"));
    expect(bridge.joinFromWelcome).toHaveBeenCalledWith(encoder.encode("w"), encoder.encode("kp"));

    const added = await engine.addMembers([encoder.encode("kp")]);
    expect(added).toEqual({ commit: encoder.encode("commit"), welcome: encoder.encode("welcome") });

    expect(await engine.removeMembers([2])).toEqual(encoder.encode("remove"));

    await engine.processCommit(encoder.encode("c"));
    expect(bridge.processCommit).toHaveBeenCalledWith(encoder.encode("c"));

    expect(await engine.encrypt(encoder.encode("hi"))).toEqual(encoder.encode("hi"));
    expect(await engine.decrypt(encoder.encode("hi"))).toEqual(encoder.encode("hi"));

    expect(await engine.epoch()).toBe(4n);
    expect(await engine.members()).toEqual([{ leafIndex: 0, identity: "aulora:device:abc" }]);

    expect(await engine.exportState()).toEqual(encoder.encode("state"));
    await engine.importState(encoder.encode("state"));
    expect(bridge.importState).toHaveBeenCalledWith(encoder.encode("state"));
  });
});
