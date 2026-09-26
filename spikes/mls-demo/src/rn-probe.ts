/**
 * RN / no-WebCrypto probe.
 *
 * Simulates a React Native / Hermes-like runtime by removing crypto.subtle
 * (keeping only getRandomValues) BEFORE importing ts-mls, then tries to run a
 * minimal MLS flow with nobleCryptoProvider (pure-JS @noble backend).
 *
 * Usage: bun run src/rn-probe.ts [noble|default]
 */
const mode = (process.argv[2] ?? "noble") as "noble" | "default" | "noble-full" | "default-full";
const full = mode.endsWith("-full");
const providerName = mode.startsWith("noble") ? "noble" : "default";

if (!full) {
  const realCrypto = globalThis.crypto;
  const fakeCrypto = {
    getRandomValues: (u: Uint8Array) => realCrypto.getRandomValues(u),
  } as unknown as Crypto;

  Object.defineProperty(globalThis, "crypto", {
    value: fakeCrypto,
    configurable: true,
    writable: true,
  });
}

console.log(`mode=${mode}`);
console.log(`globalThis.crypto=${typeof globalThis.crypto} subtle=${typeof (globalThis.crypto as any)?.subtle}`);

const tsm = await import("ts-mls");
const enc = new TextEncoder();
const cs = await tsm.getCiphersuiteImpl(
  tsm.getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519"),
  providerName === "noble" ? tsm.nobleCryptoProvider : tsm.defaultCryptoProvider,
);
console.log("ciphersuite impl created:", cs.name);

const aliceKp = await tsm.generateKeyPackage(
  { credentialType: "basic", identity: enc.encode("alice") },
  tsm.defaultCapabilities(),
  tsm.defaultLifetime,
  [],
  cs,
);
let alice = await tsm.createGroup(enc.encode("g"), aliceKp.publicPackage, aliceKp.privatePackage, [], cs);
const bobKp = await tsm.generateKeyPackage(
  { credentialType: "basic", identity: enc.encode("bob") },
  tsm.defaultCapabilities(),
  tsm.defaultLifetime,
  [],
  cs,
);
const commit = await tsm.createCommit(
  { state: alice, cipherSuite: cs },
  {
    extraProposals: [{ proposalType: "add", add: { keyPackage: bobKp.publicPackage } }],
    ratchetTreeExtension: true,
  },
);
alice = commit.newState;
const bob = await tsm.joinGroup(
  commit.welcome!,
  bobKp.publicPackage,
  bobKp.privatePackage,
  tsm.emptyPskIndex,
  cs,
);
const msg = await tsm.createApplicationMessage(alice, enc.encode("hi from no-subtle"), cs);
const recv = await tsm.processPrivateMessage(bob, msg.privateMessage, tsm.emptyPskIndex, cs, tsm.acceptAll);
const plaintext = recv.kind === "applicationMessage" ? new TextDecoder().decode(recv.message) : "<none>";
console.log(`RESULT mode=${mode}: WORKED, bob decrypted="${plaintext}"`);
