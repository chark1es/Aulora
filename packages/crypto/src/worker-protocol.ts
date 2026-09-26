/**
 * Message-passing protocol between the main thread and the MLS Worker.
 *
 * Every request carries a numeric id; every response echoes it, so calls can
 * be in flight concurrently. Wire values are copied `Uint8Array`s (and a
 * `bigint` epoch) which are structured-cloneable, so no plaintext, key bytes
 * or tokens are ever logged on this path.
 */

import type { AddMembersResult, MlsEngine, MlsMember } from "./engine.js";

export const WORKER_REQUEST = "aulora.mls.request";
export const WORKER_RESPONSE = "aulora.mls.response";

/** Minimal structural type shared by `Worker`, `MessagePort` and test doubles. */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener?(type: "message", listener: (event: { data: unknown }) => void): void;
  terminate?(): void;
}

export type WorkerOperation =
  | { op: "generateKeyPackage" }
  | { op: "createGroup"; groupId: Uint8Array; keyPackage: Uint8Array }
  | { op: "joinFromWelcome"; welcome: Uint8Array; keyPackage: Uint8Array }
  | { op: "addMembers"; keyPackages: Uint8Array[] }
  | { op: "removeMembers"; leafIndexes: number[] }
  | { op: "processCommit"; commit: Uint8Array }
  | { op: "encrypt"; plaintext: Uint8Array }
  | { op: "decrypt"; ciphertext: Uint8Array }
  | { op: "epoch" }
  | { op: "members" }
  | { op: "exportState" }
  | { op: "importState"; state: Uint8Array };

export interface WorkerRequest {
  type: typeof WORKER_REQUEST;
  id: number;
  operation: WorkerOperation;
}

export type WorkerResult =
  | { kind: "void" }
  | { kind: "bytes"; bytes: Uint8Array }
  | { kind: "epoch"; epoch: bigint }
  | { kind: "members"; members: MlsMember[] }
  | { kind: "addMembers"; commit: Uint8Array; welcome: Uint8Array };

export interface SerializedError {
  name: string;
  code?: string;
  message: string;
}

export interface WorkerSuccess {
  type: typeof WORKER_RESPONSE;
  id: number;
  ok: true;
  result: WorkerResult;
}

export interface WorkerFailure {
  type: typeof WORKER_RESPONSE;
  id: number;
  ok: false;
  error: SerializedError;
}

export type WorkerResponse = WorkerSuccess | WorkerFailure;

export type EngineFactory = () => MlsEngine | Promise<MlsEngine>;

/** Run a decoded operation against an engine and shape the result. */
export async function dispatchWorkerOperation(
  engine: MlsEngine,
  operation: WorkerOperation,
): Promise<WorkerResult> {
  switch (operation.op) {
    case "generateKeyPackage":
      return { kind: "bytes", bytes: await engine.generateKeyPackage() };
    case "createGroup":
      await engine.createGroup(operation.groupId, operation.keyPackage);
      return { kind: "void" };
    case "joinFromWelcome":
      await engine.joinFromWelcome(operation.welcome, operation.keyPackage);
      return { kind: "void" };
    case "addMembers": {
      const result: AddMembersResult = await engine.addMembers(operation.keyPackages);
      return { kind: "addMembers", commit: result.commit, welcome: result.welcome };
    }
    case "removeMembers":
      return { kind: "bytes", bytes: await engine.removeMembers(operation.leafIndexes) };
    case "processCommit":
      await engine.processCommit(operation.commit);
      return { kind: "void" };
    case "encrypt":
      return { kind: "bytes", bytes: await engine.encrypt(operation.plaintext) };
    case "decrypt":
      return { kind: "bytes", bytes: await engine.decrypt(operation.ciphertext) };
    case "epoch":
      return { kind: "epoch", epoch: await engine.epoch() };
    case "members":
      return { kind: "members", members: [...(await engine.members())] };
    case "exportState":
      return { kind: "bytes", bytes: await engine.exportState() };
    case "importState":
      await engine.importState(operation.state);
      return { kind: "void" };
    default:
      throw new Error("unhandled MLS worker operation");
  }
}

/** Build the message handler used inside the Worker (and by loopback tests). */
export function createWorkerMessageHandler(
  createEngine: EngineFactory,
): (data: unknown) => Promise<WorkerResponse | undefined> {
  let enginePromise: Promise<MlsEngine> | undefined;
  const getEngine = (): Promise<MlsEngine> => {
    enginePromise ??= Promise.resolve(createEngine());
    return enginePromise;
  };
  return async (data) => {
    if (!isWorkerRequest(data)) {
      return undefined;
    }
    try {
      const result = await dispatchWorkerOperation(await getEngine(), data.operation);
      return { type: WORKER_RESPONSE, id: data.id, ok: true, result };
    } catch (error) {
      return { type: WORKER_RESPONSE, id: data.id, ok: false, error: serializeError(error) };
    }
  };
}

/** Wire a worker-like port to an engine instance (one engine per worker). */
export function connectWorker(port: WorkerLike, createEngine: EngineFactory): void {
  const handle = createWorkerMessageHandler(createEngine);
  port.addEventListener("message", (event) => {
    void handle(event.data).then((response) => {
      if (response) {
        try {
          port.postMessage(response);
        } catch {
          // Nothing useful to do if the worker port is already closing.
        }
      }
    });
  });
}

export function isWorkerRequest(data: unknown): data is WorkerRequest {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const candidate = data as Partial<WorkerRequest>;
  return (
    candidate.type === WORKER_REQUEST &&
    typeof candidate.id === "number" &&
    "operation" in candidate
  );
}

export function isWorkerResponse(data: unknown): data is WorkerResponse {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const candidate = data as Partial<WorkerResponse>;
  return candidate.type === WORKER_RESPONSE && typeof candidate.id === "number";
}

function serializeError(error: unknown): SerializedError {
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    const typed = error as { name?: string; code?: string; message: string };
    return {
      name: typed.name ?? "MlsEngineError",
      ...(typed.code ? { code: typed.code } : {}),
      message: typed.message,
    };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "Error", message: "MLS worker operation failed" };
}
