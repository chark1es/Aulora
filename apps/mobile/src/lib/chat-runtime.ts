import {
  type ChannelSummary,
  type ChatPort,
  ChatSession,
  type ChatSubscriptions,
  type MessagePayload,
} from "@aulora/core";
import {
  createNativeMlsEngine,
  type KeyStore,
  NATIVE_MLS_TODO,
  type NativeMlsBridge,
} from "@aulora/crypto";
import type { ConvexReactClient } from "convex/react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { convexPort, convexSubscriptions } from "./convex-chat";

/**
 * Wires the MLS engine and chat session for one signed-in mobile device.
 *
 * The engine is the OpenMLS native boundary. Until OpenMLS is built for
 * iOS/Android (see `@aulora/crypto`'s `native-engine.ts`), passing no bridge
 * yields `mlsError` instead of a session, so the app can say plainly that E2EE
 * is unavailable rather than pretending a channel is encrypted. Once the
 * UniFFI module exists, the app passes its bridge and an identity key here and
 * the rest of the session is identical to web.
 */
export interface MobileChatRuntime {
  readonly session: ChatSession;
  readonly port: ChatPort;
  readonly subscriptions: ChatSubscriptions;
  readonly client: ConvexReactClient;
}

export interface CreateMobileChatRuntimeOptions {
  readonly client: ConvexReactClient;
  readonly userId: string;
  readonly displayName: string;
  readonly keyStore: KeyStore;
  /** The OpenMLS bridge; omitted until the native build lands. */
  readonly bridge?: NativeMlsBridge;
  /** Public half of this device's MLS identity, from the bridge. */
  readonly identityKey?: string;
  /** Platform tag for the device record. */
  readonly platform?: string;
}

export type MobileChatRuntimeResult =
  | { readonly runtime: MobileChatRuntime; readonly mlsError: null }
  | { readonly runtime: null; readonly mlsError: string };

export async function createMobileChatRuntime(
  options: CreateMobileChatRuntimeOptions,
): Promise<MobileChatRuntimeResult> {
  if (!options.bridge || !options.identityKey) {
    return { runtime: null, mlsError: NATIVE_MLS_TODO };
  }
  const bridge = options.bridge;
  const identityKey = options.identityKey;
  const port = convexPort(options.client);
  const subscriptions = convexSubscriptions(options.client);
  const session = ChatSession.create({
    port,
    subscriptions,
    createEngine: () => createNativeMlsEngine({ bridge }),
    user: { id: options.userId, displayName: options.displayName },
    identityKey,
    platform: options.platform ?? "mobile",
  });
  await session.start();
  return {
    runtime: { session, port, subscriptions, client: options.client },
    mlsError: null,
  };
}

export type { ChannelSummary, MessagePayload };

/** Live replies for a thread root, oldest first. */
export function watchThread(
  runtime: MobileChatRuntime,
  threadRootId: string,
  onChange: (messages: readonly MessagePayload[]) => void,
): () => void {
  const watch = runtime.client.watchQuery(api.messages.listThread, {
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
