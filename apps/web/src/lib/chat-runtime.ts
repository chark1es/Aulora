import {
  type ChannelSummary,
  type ChatPort,
  ChatSession,
  type MessagePayload,
  type ChatSubscriptions as Subscriptions,
} from "@aulora/core";
import {
  createWebMlsEngine,
  createWorkerMlsEngine,
  ensureDeviceIdentity,
  indexedDbKeyStore,
  type MlsEngine,
  type WorkerLike,
} from "@aulora/crypto";
import type { ConvexReactClient } from "convex/react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { convexPort, convexSubscriptions } from "./convex-chat";

/**
 * Wires the MLS engine and the chat session for one signed-in device.
 *
 * - The device identity is created on the main thread and persisted in
 *   IndexedDB, so the Worker engine (started with the same key store) sees the
 *   same identity and the public half can be registered with the server.
 * - The engine runs in a Web Worker when available; `createWorkerMlsEngine`
 *   falls back to a direct engine where `Worker` is unavailable.
 * - No plaintext, key material or token is ever logged here.
 */
export interface ChatRuntime {
  readonly session: ChatSession;
  readonly port: ChatPort;
  readonly subscriptions: Subscriptions;
  readonly client: ConvexReactClient;
  /** Live replies for a thread root, oldest first. */
  watchThread(
    threadRootId: string,
    onChange: (messages: readonly MessagePayload[]) => void,
  ): () => void;
}

export interface CreateChatRuntimeOptions {
  readonly client: ConvexReactClient;
  readonly userId: string;
  readonly displayName: string;
  readonly keyStore?: ReturnType<typeof indexedDbKeyStore>;
}

/**
 * Creates one MLS engine over the shared device key store. Each channel gets
 * its own engine so concurrent groups never share an active ratchet state.
 */
function createEngine(keyStore: ReturnType<typeof indexedDbKeyStore>): MlsEngine {
  return createWorkerMlsEngine({
    workerFactory: (): WorkerLike | undefined => {
      if (typeof Worker === "undefined") {
        return undefined;
      }
      return new Worker(new URL("@aulora/crypto/worker", import.meta.url), {
        type: "module",
      }) as unknown as WorkerLike;
    },
    // Falls back to a direct IndexedDB-backed engine under the same identity.
    fallback: () => createWebMlsEngine({ keyStore }),
  });
}

/** Builds the session for one signed-in device. */
export async function createChatRuntime(options: CreateChatRuntimeOptions): Promise<ChatRuntime> {
  const keyStore = options.keyStore ?? indexedDbKeyStore();
  const identity = await ensureDeviceIdentity(keyStore);
  const port = convexPort(options.client);
  const subscriptions: Subscriptions = convexSubscriptions(options.client);
  const session = ChatSession.create({
    port,
    subscriptions,
    createEngine: () => createEngine(keyStore),
    user: { id: options.userId, displayName: options.displayName },
    identityKey: bytesToHex(identity.signaturePublicKey),
    platform: "web",
  });
  await session.start();

  function watchThread(
    threadRootId: string,
    onChange: (messages: readonly MessagePayload[]) => void,
  ): () => void {
    const watch = options.client.watchQuery(api.messages.listThread, {
      threadRootId: threadRootId as never,
      paginationOpts: { numItems: 100, cursor: null },
    });
    const unsubscribe = watch.onUpdate(() => {
      const value = watch.localQueryResult();
      if (value !== undefined) {
        onChange(value.page);
      }
    });
    return () => {
      unsubscribe();
    };
  }

  return { session, port, subscriptions, client: options.client, watchThread };
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export type { ChannelSummary };
