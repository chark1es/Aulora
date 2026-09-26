import type { MlsEngine } from "../src/index.js";

/** Stable, comparable transcript of the Phase 2 two-device scenario. */
export interface DeviceTranscript {
  epochAfterCreate: string;
  epochAfterAdd: string;
  epochAfterRemove: string;
  joinedEpoch: string;
  memberLeafIndexes: number[];
  bobDecryptsAlice: string;
  aliceDecryptsBob: string;
  postRemovalDecryptFailed: boolean;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * End-to-end two-device flow through the `MlsEngine` interface:
 * creator opens a group, joiner publishes a KeyPackage, creator adds it
 * (commit + welcome), joiner joins, both send and decrypt, creator removes the
 * joiner, and the joiner can no longer decrypt.
 */
export async function runTwoDeviceScenario(
  creator: MlsEngine,
  joiner: MlsEngine,
): Promise<DeviceTranscript> {
  const groupId = encoder.encode("aulora:channel:phase2");
  const creatorKeyPackage = await creator.generateKeyPackage();
  await creator.createGroup(groupId, creatorKeyPackage);
  const epochAfterCreate = (await creator.epoch()).toString();

  const joinerKeyPackage = await joiner.generateKeyPackage();
  const { welcome } = await creator.addMembers([joinerKeyPackage]);
  const epochAfterAdd = (await creator.epoch()).toString();

  await joiner.joinFromWelcome(welcome, joinerKeyPackage);
  const joinedEpoch = (await joiner.epoch()).toString();

  const members = await creator.members();
  const joinerMember = members.find((member) => member.leafIndex !== 0);
  if (!joinerMember) {
    throw new Error("expected the joiner to be a second member");
  }

  const creatorCiphertext = await creator.encrypt(encoder.encode("hello joiner"));
  const bobDecryptsAlice = decoder.decode(await joiner.decrypt(creatorCiphertext));

  const joinerCiphertext = await joiner.encrypt(encoder.encode("hello creator"));
  const aliceDecryptsBob = decoder.decode(await creator.decrypt(joinerCiphertext));

  const removalCommit = await creator.removeMembers([joinerMember.leafIndex]);
  const epochAfterRemove = (await creator.epoch()).toString();
  await joiner.processCommit(removalCommit);

  let postRemovalDecryptFailed = false;
  try {
    const postRemoval = await creator.encrypt(encoder.encode("after removal"));
    await joiner.decrypt(postRemoval);
  } catch {
    postRemovalDecryptFailed = true;
  }

  return {
    epochAfterCreate,
    epochAfterAdd,
    epochAfterRemove,
    joinedEpoch,
    memberLeafIndexes: members.map((member) => member.leafIndex),
    bobDecryptsAlice,
    aliceDecryptsBob,
    postRemovalDecryptFailed,
  };
}
