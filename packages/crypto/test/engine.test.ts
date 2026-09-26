import { describe, expect, it } from "vitest";
import {
  AULORA_CIPHER_SUITE,
  createWebMlsEngine,
  type MlsEngine,
  MlsEngineError,
  memoryKeyStore,
} from "../src/index.js";
import { runTwoDeviceScenario } from "./scenario.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function createDevice(): MlsEngine {
  return createWebMlsEngine({ keyStore: memoryKeyStore() });
}

async function establishGroup(): Promise<{ creator: MlsEngine; joiner: MlsEngine }> {
  const creator = createDevice();
  const joiner = createDevice();
  await creator.createGroup(
    encoder.encode("aulora:channel:export"),
    await creator.generateKeyPackage(),
  );
  const joinerKeyPackage = await joiner.generateKeyPackage();
  const { welcome } = await creator.addMembers([joinerKeyPackage]);
  await joiner.joinFromWelcome(welcome, joinerKeyPackage);
  return { creator, joiner };
}

describe("web MLS engine (ts-mls)", () => {
  it("pins the Phase 0 ciphersuite", () => {
    expect(AULORA_CIPHER_SUITE).toBe("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519");
  });

  it("runs the two-device scenario end to end through the interface", async () => {
    const transcript = await runTwoDeviceScenario(createDevice(), createDevice());

    expect(transcript.epochAfterCreate).toBe("0");
    expect(transcript.epochAfterAdd).toBe("1");
    expect(transcript.joinedEpoch).toBe("1");
    expect(transcript.epochAfterRemove).toBe("2");
    expect(transcript.memberLeafIndexes).toEqual([0, 1]);
    expect(transcript.bobDecryptsAlice).toBe("hello joiner");
    expect(transcript.aliceDecryptsBob).toBe("hello creator");
    expect(transcript.postRemovalDecryptFailed).toBe(true);
  });

  it("exposes stable device identities for members", async () => {
    const { creator } = await establishGroup();
    const members = await creator.members();
    expect(members).toHaveLength(2);
    for (const member of members) {
      expect(member.identity.startsWith("aulora:device:")).toBe(true);
    }
  });

  it("round-trips exported state and still decrypts", async () => {
    const { creator, joiner } = await establishGroup();
    const exported = await joiner.exportState();

    const restored = createDevice();
    await restored.importState(exported);
    expect(await restored.epoch()).toBe(await joiner.epoch());

    const ciphertext = await creator.encrypt(encoder.encode("survives restore"));
    expect(decoder.decode(await restored.decrypt(ciphertext))).toBe("survives restore");
  });

  it("rejects a public commit passed to decrypt instead of processCommit", async () => {
    const { creator, joiner } = await establishGroup();
    const members = await creator.members();
    const joinerMember = members.find((member) => member.leafIndex !== 0);
    if (!joinerMember) {
      throw new Error("expected two members");
    }
    const removeCommit = await creator.removeMembers([joinerMember.leafIndex]);
    await expect(joiner.decrypt(removeCommit)).rejects.toBeInstanceOf(MlsEngineError);
  });
});
