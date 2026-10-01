import { type ChannelSummary, ChatSession, type MessagePayload } from "@aulora/core";
import type { ConvexReactClient } from "convex/react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import type { ChatSurfaceRuntime } from "./chat-surface";
import { convexPort, convexSubscriptions } from "./convex-chat";
import { devicePushPlatform } from "./push";

/**
 * Wires the chat session for one signed-in mobile device.
 *
 * Content is plaintext between this client and the server, which seals it at
 * rest with its External Key Manager; the client holds no key and does no
 * cryptographic work. The device row is registered on start so push wakes can
 * reach it.
 */
export interface MobileChatRuntime extends ChatSurfaceRuntime {
  readonly client: ConvexReactClient;
}

export interface CreateMobileChatRuntimeOptions {
  readonly client: ConvexReactClient;
  /** Platform tag for the device record. Defaults to the real `Platform.OS`. */
  readonly platform?: string;
}

export async function createMobileChatRuntime(
  options: CreateMobileChatRuntimeOptions,
): Promise<MobileChatRuntime> {
  const port = convexPort(options.client);
  const subscriptions = convexSubscriptions(options.client);
  const session = ChatSession.create({ port, subscriptions });
  await port.upsertDevice({ platform: options.platform ?? devicePushPlatform() });
  await session.start();
  return {
    session,
    port,
    subscriptions,
    client: options.client,
    watchThread: (threadRootId, onChange) =>
      watchConvexThread(options.client, threadRootId, onChange),
  };
}

export type { ChannelSummary, MessagePayload };

/** Live replies for a thread root, oldest first. */
function watchConvexThread(
  client: ConvexReactClient,
  threadRootId: string,
  onChange: (messages: readonly MessagePayload[]) => void,
): () => void {
  const watch = client.watchQuery(api.messages.listThread, {
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
