/**
 * Main-thread proxy for the MLS Worker.
 *
 * Decrypt and commit processing run in the worker so the UI thread never
 * blocks on ratchet work. When no Worker runtime is available (for example
 * under vitest, or a constrained webview) the factory gracefully falls back to
 * a direct engine.
 */

import type { AddMembersResult, MlsEngine, MlsMember } from "./engine.js";
import { MlsEngineError, type MlsEngineErrorCode } from "./errors.js";
import { indexedDbKeyStore } from "./indexeddb.js";
import { createWebMlsEngine } from "./web-engine.js";
import {
  isWorkerResponse,
  type SerializedError,
  WORKER_REQUEST,
  type WorkerLike,
  type WorkerOperation,
  type WorkerResult,
} from "./worker-protocol.js";

export interface WorkerMlsEngineOptions {
  /** Pre-connected worker-like transport (tests, custom runtimes). */
  worker?: WorkerLike;
  /**
   * Create the worker transport. Return `undefined` to signal that no Worker
   * is available and fall through to `fallback`.
   */
  workerFactory?: () => WorkerLike | undefined;
  /** Direct engine used when no Worker transport is available. */
  fallback?: () => MlsEngine;
}

/** Create an MLS engine that runs inside a Web Worker, with a direct fallback. */
export function createWorkerMlsEngine(options: WorkerMlsEngineOptions = {}): MlsEngine {
  let transport = options.worker;
  if (!transport && options.workerFactory) {
    transport = options.workerFactory();
  }
  if (!transport && !options.workerFactory && typeof Worker !== "undefined") {
    transport = spawnDefaultWorker();
  }
  if (!transport) {
    return (options.fallback ?? defaultFallback)();
  }
  return new RemoteMlsEngine(transport);
}

function defaultFallback(): MlsEngine {
  return createWebMlsEngine({ keyStore: indexedDbKeyStore() });
}

function spawnDefaultWorker(): WorkerLike {
  const worker = new Worker(new URL("./worker-entry.ts", import.meta.url), { type: "module" });
  return worker as unknown as WorkerLike;
}

interface PendingCall {
  resolve(result: WorkerResult): void;
  reject(error: unknown): void;
}

class RemoteMlsEngine implements MlsEngine {
  private readonly transport: WorkerLike;
  private readonly pending = new Map<number, PendingCall>();
  private nextId = 1;

  constructor(transport: WorkerLike) {
    this.transport = transport;
    transport.addEventListener("message", (event) => this.onMessage(event.data));
  }

  private onMessage(data: unknown): void {
    if (!isWorkerResponse(data)) {
      return;
    }
    const call = this.pending.get(data.id);
    if (!call) {
      return;
    }
    this.pending.delete(data.id);
    if (data.ok) {
      call.resolve(data.result);
    } else {
      call.reject(deserializeError(data.error));
    }
  }

  private request(operation: WorkerOperation): Promise<WorkerResult> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<WorkerResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.transport.postMessage({ type: WORKER_REQUEST, id, operation });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async generateKeyPackage(): Promise<Uint8Array> {
    return expectBytes(await this.request({ op: "generateKeyPackage" }));
  }

  async createGroup(groupId: Uint8Array, keyPackage: Uint8Array): Promise<void> {
    await this.request({ op: "createGroup", groupId, keyPackage });
  }

  async joinFromWelcome(welcome: Uint8Array, keyPackage: Uint8Array): Promise<void> {
    await this.request({ op: "joinFromWelcome", welcome, keyPackage });
  }

  async addMembers(keyPackages: readonly Uint8Array[]): Promise<AddMembersResult> {
    const result = await this.request({ op: "addMembers", keyPackages: [...keyPackages] });
    if (result.kind !== "addMembers") {
      throw unexpectedResult();
    }
    return { commit: result.commit, welcome: result.welcome };
  }

  async removeMembers(leafIndexes: readonly number[]): Promise<Uint8Array> {
    return expectBytes(await this.request({ op: "removeMembers", leafIndexes: [...leafIndexes] }));
  }

  async processCommit(commit: Uint8Array): Promise<void> {
    await this.request({ op: "processCommit", commit });
  }

  async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
    return expectBytes(await this.request({ op: "encrypt", plaintext }));
  }

  async decrypt(ciphertext: Uint8Array): Promise<Uint8Array> {
    return expectBytes(await this.request({ op: "decrypt", ciphertext }));
  }

  async epoch(): Promise<bigint> {
    const result = await this.request({ op: "epoch" });
    if (result.kind !== "epoch") {
      throw unexpectedResult();
    }
    return result.epoch;
  }

  async members(): Promise<readonly MlsMember[]> {
    const result = await this.request({ op: "members" });
    if (result.kind !== "members") {
      throw unexpectedResult();
    }
    return result.members;
  }

  async exportState(): Promise<Uint8Array> {
    return expectBytes(await this.request({ op: "exportState" }));
  }

  async importState(state: Uint8Array): Promise<void> {
    await this.request({ op: "importState", state });
  }
}

function expectBytes(result: WorkerResult): Uint8Array {
  if (result.kind !== "bytes") {
    throw unexpectedResult();
  }
  return result.bytes;
}

function unexpectedResult(): MlsEngineError {
  return new MlsEngineError("unsupported-message", "unexpected MLS worker result");
}

function deserializeError(serialized: SerializedError): Error {
  if (serialized.code) {
    const error = new MlsEngineError(serialized.code as MlsEngineErrorCode, serialized.message);
    error.name = serialized.name;
    return error;
  }
  const error = new Error(serialized.message);
  error.name = serialized.name;
  return error;
}
