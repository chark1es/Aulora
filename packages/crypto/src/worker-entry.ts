/// <reference lib="webworker" />
/**
 * Worker entry point.
 *
 * A dedicated MLS Worker is started by `createWorkerMlsEngine()` and owns a
 * single ts-mls engine with an IndexedDB key store. Import this module only in
 * a Worker scope; {@link startMlsWorkerScope} is exported for explicit wiring.
 */

import { indexedDbKeyStore } from "./indexeddb.js";
import { createWebMlsEngine } from "./web-engine.js";
import { connectWorker, type WorkerLike } from "./worker-protocol.js";

/** Engine factory used inside the worker (`indexedDbKeyStore` + ts-mls). */
export function createDefaultWorkerEngine() {
  return createWebMlsEngine({ keyStore: indexedDbKeyStore() });
}

/** Attach the MLS request handler to a worker-like scope. */
export function startMlsWorkerScope(scope: WorkerLike = globalThis as unknown as WorkerLike): void {
  connectWorker(scope, createDefaultWorkerEngine);
}

if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  startMlsWorkerScope();
}
