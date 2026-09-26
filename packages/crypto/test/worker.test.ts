import { describe, expect, it } from "vitest";
import {
  connectWorker,
  createWebMlsEngine,
  createWorkerMlsEngine,
  type MlsEngine,
  memoryKeyStore,
  type WorkerLike,
} from "../src/index.js";
import { runTwoDeviceScenario } from "./scenario.js";

type Listener = (event: { data: unknown }) => void;

/**
 * In-process pair of worker-like ports. Messages are structured-cloned so the
 * test exercises the real serialization contract (Uint8Array payloads and a
 * bigint epoch) without needing a browser Worker under vitest.
 */
function createLoopbackPair(): { main: WorkerLike; worker: WorkerLike } {
  const mainListeners: Listener[] = [];
  const workerListeners: Listener[] = [];

  const main: WorkerLike = {
    postMessage: (message) => {
      const cloned = structuredClone(message);
      queueMicrotask(() => {
        for (const listener of workerListeners) {
          listener({ data: cloned });
        }
      });
    },
    addEventListener: (_type, listener) => {
      mainListeners.push(listener);
    },
  };

  const worker: WorkerLike = {
    postMessage: (message) => {
      const cloned = structuredClone(message);
      queueMicrotask(() => {
        for (const listener of mainListeners) {
          listener({ data: cloned });
        }
      });
    },
    addEventListener: (_type, listener) => {
      workerListeners.push(listener);
    },
  };

  return { main, worker };
}

function createDevice(): MlsEngine {
  return createWebMlsEngine({ keyStore: memoryKeyStore() });
}

describe("worker MLS engine", () => {
  it("produces identical results to the direct engine through the proxy protocol", async () => {
    const direct = await runTwoDeviceScenario(createDevice(), createDevice());

    const { main, worker } = createLoopbackPair();
    connectWorker(worker, () => createDevice());
    const proxied = await runTwoDeviceScenario(
      createDevice(),
      createWorkerMlsEngine({ worker: main }),
    );

    expect(proxied).toEqual(direct);
  });

  it("falls back to a direct engine when no Worker runtime is available", async () => {
    let fallbackUsed = false;
    const proxied = createWorkerMlsEngine({
      workerFactory: () => undefined,
      fallback: () => {
        fallbackUsed = true;
        return createDevice();
      },
    });

    const transcript = await runTwoDeviceScenario(createDevice(), proxied);
    expect(fallbackUsed).toBe(true);
    expect(transcript.bobDecryptsAlice).toBe("hello joiner");
    expect(transcript.postRemovalDecryptFailed).toBe(true);
  });
});
