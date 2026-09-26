/// <reference lib="webworker" />
/**
 * Runs a minimal two-party MLS flow inside a Web Worker in a real browser.
 * Bundled by `bun build --target browser` and loaded as a module worker.
 */
import {
  acceptAll,
  createApplicationMessage,
  createCommit,
  createGroup,
  defaultCapabilities,
  defaultLifetime,
  emptyPskIndex,
  generateKeyPackage,
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  joinGroup,
  processPrivateMessage,
} from "ts-mls";

const enc = new TextEncoder();
const dec = new TextDecoder();
const post = (payload: unknown) => (self as unknown as Worker).postMessage(payload);

async function run() {
  const report: Record<string, unknown> = {
    hasCrypto: typeof globalThis.crypto,
    hasSubtle: typeof globalThis.crypto?.subtle,
    hasGetRandomValues: typeof globalThis.crypto?.getRandomValues,
    isWorker: typeof (self as any).importScripts === "function" || typeof (self as any).Window === "undefined",
  };
  const cs = await getCiphersuiteImpl(getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519"));
  const aliceKp = await generateKeyPackage(
    { credentialType: "basic", identity: enc.encode("alice") },
    defaultCapabilities(),
    defaultLifetime,
    [],
    cs,
  );
  let alice = await createGroup(enc.encode("browser-group"), aliceKp.publicPackage, aliceKp.privatePackage, [], cs);
  const bobKp = await generateKeyPackage(
    { credentialType: "basic", identity: enc.encode("bob") },
    defaultCapabilities(),
    defaultLifetime,
    [],
    cs,
  );
  const commit = await createCommit(
    { state: alice, cipherSuite: cs },
    {
      extraProposals: [{ proposalType: "add", add: { keyPackage: bobKp.publicPackage } }],
      ratchetTreeExtension: true,
    },
  );
  alice = commit.newState;
  const bob = await joinGroup(commit.welcome!, bobKp.publicPackage, bobKp.privatePackage, emptyPskIndex, cs);
  const m = await createApplicationMessage(alice, enc.encode("hello from inside a browser Worker"), cs);
  const recv = await processPrivateMessage(bob, m.privateMessage, emptyPskIndex, cs, acceptAll);
  report["decrypted"] = recv.kind === "applicationMessage" ? dec.decode(recv.message) : "<none>";
  report["epoch"] = alice.groupContext.epoch.toString();
  report["ok"] = true;
  return report;
}

run()
  .then((r) => post({ type: "result", report: r }))
  .catch((e) => post({ type: "error", message: String(e), stack: (e as Error).stack }));
