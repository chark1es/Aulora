/**
 * Spike B (Phase 0) - two-device MLS (RFC 9420) demo using ts-mls, run with bun.
 *
 * Scenario:
 *   1. Alice creates an MLS group with a self-asserted (Basic) credential identity.
 *   2. Bob creates a KeyPackage.
 *   3. Alice adds Bob (Add proposal + Commit) and produces a Welcome; Bob joins.
 *   4. Alice encrypts an application message; Bob decrypts and prints plaintext.
 *   5. Bob encrypts a reply; Alice decrypts it.
 *   6. Alice removes Bob (Remove proposal + Commit); Bob's next decrypt FAILS.
 *
 * Every wire message is serialized with encodeMlsMessage / decodeMlsMessage to
 * simulate actual transport between two devices.
 */
import {
  acceptAll,
  createApplicationMessage,
  createCommit,
  createGroup,
  decodeMlsMessage,
  defaultCapabilities,
  defaultLifetime,
  emptyPskIndex,
  encodeMlsMessage,
  generateKeyPackage,
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  joinGroup,
  processPrivateMessage,
  processPublicMessage,
  zeroOutUint8Array,
} from "ts-mls";

import type { ClientState, Credential, MLSMessage, Proposal } from "ts-mls";

const enc = new TextEncoder();
const dec = new TextDecoder();

const CIPHERSUITE_NAME = "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519";
const GROUP_ID = enc.encode("aulora-phase0-mls-group");

let stepNo = 0;
function step(msg: string): void {
  stepNo += 1;
  console.log(`\n[STEP ${String(stepNo).padStart(2, "0")}] ${msg}`);
}
function info(msg: string): void {
  console.log(`         ${msg}`);
}
function proof(msg: string): void {
  console.log(`  [PROOF] ${msg}`);
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function basicCredential(identity: string): Credential {
  return { credentialType: "basic", identity: enc.encode(identity) };
}

function identityOf(state: ClientState, leafIndex: number): string | undefined {
  const node = state.ratchetTree[leafIndex * 2];
  if (!node || node.nodeType !== "leaf") return undefined;
  const cred = node.leaf.credential;
  if (cred.credentialType !== "basic") return undefined;
  return dec.decode(cred.identity);
}

function findLeafIndex(state: ClientState, identity: string): number {
  for (let nodeIndex = 0; nodeIndex < state.ratchetTree.length; nodeIndex += 2) {
    const leaf = identityOf(state, nodeIndex / 2);
    if (leaf === identity) return nodeIndex / 2;
  }
  throw new Error(`leaf not found for identity: ${identity}`);
}

function membersOf(state: ClientState): string[] {
  const out: string[] = [];
  for (let i = 0; i * 2 < state.ratchetTree.length; i++) {
    const id = identityOf(state, i);
    if (id !== undefined) out.push(`${id} (leaf ${i})`);
  }
  return out;
}

/** Serialize + deserialize an MLS message to simulate network transport. */
function roundTrip(message: MLSMessage, expectedWireformat: string): MLSMessage {
  const wire = encodeMlsMessage(message);
  const result = decodeMlsMessage(wire, 0);
  assert(result !== undefined, `decodeMlsMessage returned undefined for ${expectedWireformat}`);
  const [decoded, consumed] = result;
  assert(
    decoded.wireformat === expectedWireformat,
    `wireformat mismatch: got ${decoded.wireformat}, expected ${expectedWireformat}`,
  );
  info(
    `wire ${expectedWireformat}: encoded ${wire.length} bytes, decoded ${consumed} bytes  first16=${hex(wire, 16)}`,
  );
  return decoded;
}

function hex(bytes: Uint8Array, n = 16): string {
  return Buffer.from(bytes.slice(0, n)).toString("hex");
}

async function main(): Promise<void> {
  console.log("=".repeat(78));
  console.log("Aulora Spike B - ts-mls two-device MLS (RFC 9420) demo");
  console.log("=".repeat(78));
  info(`runtime       : bun ${process.versions.bun ?? "?"} / node ${process.versions.node}`);
  info(`crypto global : ${typeof globalThis.crypto}  subtle=${typeof globalThis.crypto?.subtle}`);
  info(`ciphersuite   : ${CIPHERSUITE_NAME}`);

  const cs = await getCiphersuiteImpl(getCiphersuiteFromName(CIPHERSUITE_NAME));
  proof(`ciphersuite impl loaded: ${cs.name}`);

  // ---------------------------------------------------------------- 1. Alice
  step("Alice creates the MLS group with a Basic (self-asserted) credential identity");
  const aliceKp = await generateKeyPackage(
    basicCredential("alice"),
    defaultCapabilities(),
    defaultLifetime,
    [],
    cs,
  );
  const alice = await createGroup(GROUP_ID, aliceKp.publicPackage, aliceKp.privatePackage, [], cs);
  const aliceSigPub = alice.ratchetTree[0]?.nodeType === "leaf"
    ? alice.ratchetTree[0].leaf.signaturePublicKey
    : new Uint8Array();
  proof(`group created by alice, epoch=${alice.groupContext.epoch}, members=[${membersOf(alice).join(", ")}]`);
  proof(`alice credential signature public key (ed25519, binds identity->key): ${hex(aliceSigPub)}...`);

  // ------------------------------------------------------------------ 2. Bob
  step("Bob creates a KeyPackage");
  const bobKp = await generateKeyPackage(
    basicCredential("bob"),
    defaultCapabilities(),
    defaultLifetime,
    [],
    cs,
  );
  const bobKpMsg: MLSMessage = {
    version: "mls10",
    wireformat: "mls_key_package",
    keyPackage: bobKp.publicPackage,
  } as MLSMessage;
  const decodedKp = roundTrip(bobKpMsg, "mls_key_package");
  assert(decodedKp.wireformat === "mls_key_package", "key package wireformat");
  proof(`bob KeyPackage generated and transmitted (${membersOf(alice).length} member currently in group)`);

  // -------------------------------------------------------- 3. Add + Welcome
  step("Alice adds Bob (Add proposal + Commit) and produces a Welcome");
  const addProposal: Proposal = { proposalType: "add", add: { keyPackage: decodedKp.keyPackage } };
  const addCommit = await createCommit(
    { state: alice, cipherSuite: cs },
    { extraProposals: [addProposal], ratchetTreeExtension: true },
  );
  let aliceState = addCommit.newState;
  addCommit.consumed.forEach(zeroOutUint8Array);
  assert(addCommit.welcome !== undefined, "add commit produced a Welcome");
  proof(
    `alice committed Add at epoch=${aliceState.groupContext.epoch}, members=[${membersOf(aliceState).join(", ")}]`,
  );

  const welcomeMsg: MLSMessage = {
    version: "mls10",
    wireformat: "mls_welcome",
    welcome: addCommit.welcome,
  } as MLSMessage;
  const decodedWelcome = roundTrip(welcomeMsg, "mls_welcome");

  step("Bob processes the Welcome and joins the group");
  assert(decodedWelcome.wireformat === "mls_welcome", "welcome wireformat");
  let bobState = await joinGroup(
    decodedWelcome.welcome,
    bobKp.publicPackage,
    bobKp.privatePackage,
    emptyPskIndex,
    cs,
  );
  proof(
    `bob joined at epoch=${bobState.groupContext.epoch} (alice epoch=${aliceState.groupContext.epoch}), members=[${membersOf(bobState).join(", ")}]`,
  );
  assert(
    bobState.groupContext.epoch === aliceState.groupContext.epoch,
    "alice and bob agree on epoch after join",
  );

  // ------------------------------------------------------- 4. Alice -> Bob
  step("Alice encrypts an application message; Bob decrypts it");
  const fromAlice = "hello bob, this is an MLS application message from alice";
  const aMsg = await createApplicationMessage(aliceState, enc.encode(fromAlice), cs);
  aliceState = aMsg.newState;
  aMsg.consumed.forEach(zeroOutUint8Array);
  const aWire: MLSMessage = {
    version: "mls10",
    wireformat: "mls_private_message",
    privateMessage: aMsg.privateMessage,
  } as MLSMessage;
  const aDecoded = roundTrip(aWire, "mls_private_message");
  assert(aDecoded.wireformat === "mls_private_message", "private message wireformat");

  const bobRecv1 = await processPrivateMessage(
    bobState,
    aDecoded.privateMessage,
    emptyPskIndex,
    cs,
    acceptAll,
  );
  bobState = bobRecv1.newState;
  assert(bobRecv1.kind === "applicationMessage", `expected applicationMessage, got ${bobRecv1.kind}`);
  const bobPlaintext = dec.decode(bobRecv1.message);
  bobRecv1.consumed.forEach(zeroOutUint8Array);
  proof(`bob decrypted plaintext: "${bobPlaintext}"`);
  assert(bobPlaintext === fromAlice, "bob plaintext equals alice plaintext");

  // ------------------------------------------------------- 5. Bob -> Alice
  step("Bob encrypts a reply; Alice decrypts it");
  const fromBob = "hi alice, bob got it and replies over MLS";
  const bMsg = await createApplicationMessage(bobState, enc.encode(fromBob), cs);
  bobState = bMsg.newState;
  bMsg.consumed.forEach(zeroOutUint8Array);
  const bWire: MLSMessage = {
    version: "mls10",
    wireformat: "mls_private_message",
    privateMessage: bMsg.privateMessage,
  } as MLSMessage;
  const bDecoded = roundTrip(bWire, "mls_private_message");
  assert(bDecoded.wireformat === "mls_private_message", "reply wireformat");

  const aliceRecv = await processPrivateMessage(
    aliceState,
    bDecoded.privateMessage,
    emptyPskIndex,
    cs,
    acceptAll,
  );
  aliceState = aliceRecv.newState;
  assert(aliceRecv.kind === "applicationMessage", `expected applicationMessage, got ${aliceRecv.kind}`);
  const alicePlaintext = dec.decode(aliceRecv.message);
  aliceRecv.consumed.forEach(zeroOutUint8Array);
  proof(`alice decrypted plaintext: "${alicePlaintext}"`);
  assert(alicePlaintext === fromBob, "alice plaintext equals bob plaintext");

  // ---------------------------------------------------------- 6. Remove Bob
  step("Alice removes Bob (Remove proposal + public Commit)");
  const bobLeafIndex = findLeafIndex(aliceState, "bob");
  info(`bob is at leaf index ${bobLeafIndex}`);
  const removeProposal: Proposal = {
    proposalType: "remove",
    remove: { removed: bobLeafIndex },
  };
  const removeCommit = await createCommit(
    { state: aliceState, cipherSuite: cs },
    { extraProposals: [removeProposal], wireAsPublicMessage: true },
  );
  aliceState = removeCommit.newState;
  removeCommit.consumed.forEach(zeroOutUint8Array);
  proof(
    `alice committed Remove at epoch=${aliceState.groupContext.epoch}, members=[${membersOf(aliceState).join(", ")}]`,
  );

  // Bob processes his own removal (public commit).
  step("Bob processes the removal commit");
  const removeWire = roundTrip(removeCommit.commit, removeCommit.commit.wireformat);
  assert(removeWire.wireformat === "mls_public_message", "removal commit should be a public message");
  let bobRemovedFromGroup = false;
  try {
    const bobAfterRemove = await processPublicMessage(
      bobState,
      removeWire.publicMessage,
      emptyPskIndex,
      cs,
      acceptAll,
    );
    bobState = bobAfterRemove.newState;
    bobAfterRemove.consumed.forEach(zeroOutUint8Array);
    bobRemovedFromGroup = bobState.groupActiveState.kind === "removedFromGroup";
    proof(`bob processed the removal commit; groupActiveState=${bobState.groupActiveState.kind}`);
  } catch (err) {
    info(`bob could not process the removal commit: ${(err as Error).message}`);
  }

  // ------------------------------------------- 7. Post-removal decrypt fails
  step("Alice sends a new application message; Bob's decrypt MUST fail");
  const postRemoval = "this message is for the group after bob was removed";
  const postMsg = await createApplicationMessage(aliceState, enc.encode(postRemoval), cs);
  aliceState = postMsg.newState;
  postMsg.consumed.forEach(zeroOutUint8Array);
  const postWire: MLSMessage = {
    version: "mls10",
    wireformat: "mls_private_message",
    privateMessage: postMsg.privateMessage,
  } as MLSMessage;
  const postDecoded = roundTrip(postWire, "mls_private_message");
  assert(postDecoded.wireformat === "mls_private_message", "post-removal wireformat");

  let removalFailure: Error | undefined;
  try {
    const bobRecv2 = await processPrivateMessage(
      bobState,
      postDecoded.privateMessage,
      emptyPskIndex,
      cs,
      acceptAll,
    );
    if (bobRecv2.kind === "applicationMessage") {
      proof(`UNEXPECTED: bob decrypted a post-removal message: "${dec.decode(bobRecv2.message)}"`);
      throw new Error("removed member decrypted a post-removal application message");
    }
    info(`bob processed but did not yield an application message (kind=${bobRecv2.kind})`);
  } catch (err) {
    removalFailure = err as Error;
  }
  assert(removalFailure !== undefined, "removed member must fail to decrypt a post-removal message");
  proof(
    `bob's post-removal decrypt FAILED as expected: ${removalFailure.name}: ${removalFailure.message}`,
  );
  info(`bobRemovedFromGroup=${bobRemovedFromGroup}`);

  console.log("\n" + "=".repeat(78));
  console.log("RESULT: all steps completed. Add/Welcome/messaging/Remove all verified.");
  console.log("=".repeat(78));
}

main().catch((err) => {
  console.error("\nDEMO FAILED:");
  console.error(err);
  process.exitCode = 1;
});
