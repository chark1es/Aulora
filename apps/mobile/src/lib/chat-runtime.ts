import {
  type ChannelSummary,
  type ChatPort,
  ChatSession,
  type ChatSubscriptions,
  type MessagePayload,
} from "@aulora/core";
import type { ConvexReactClient } from "convex/react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { convexPort, convexSubscriptions } from "./convex-chat";

/**
 * Wires the chat session for one signed-in mobile device.
 *
 * Content is plaintext between this client and the server, which seals it at
 * rest with its External Key Manager; the client holds no key and does no
 * cryptographic work. The device row is registered on start so push wakes can
 * reach it.
 */
export interface MobileChatRuntime {
  readonly session: ChatSession;
  readonly port: ChatPort;
  readonly subscriptions: ChatSubscriptions;
  readonly client: ConvexReactClient;
}

export interface CreateMobileChatRuntimeOptions {
  readonly client: ConvexReactClient;
  /** Platform tag for the device record. Defaults to `"mobile"`. */
  readonly platform?: string;
}

export async function createMobileChatRuntime(
  options: CreateMobileChatRuntimeOptions,
): Promise<MobileChatRuntime> {
  const port = convexPort(options.client);
  const subscriptions = convexSubscriptions(options.client);
  const session = ChatSession.create({ port, subscriptions });
  await port.upsertDevice({ platform: options.platform ?? "mobile" });
  await session.start();
  return { session, port, subscriptions, client: options.client };
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
  const emit = () => {
    const value = watch.localQueryResult();
    if (value !== undefined) {
      onChange(value.page);
    }
  };
  const unsubscribe = watch.onUpdate(emit);
  emit();
  return () => {
    unsubscribe();
  };
}
