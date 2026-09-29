import {
  type ChannelSummary,
  type ChatPort,
  ChatSession,
  type MessagePayload,
  type Paginated,
  type ChatSubscriptions as Subscriptions,
} from "@aulora/core";
import type { ConvexReactClient } from "convex/react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { convexPort, convexSubscriptions } from "./convex-chat";
import { isDesktop } from "./desktop";

/**
 * Wires the plaintext chat session to the Convex port for one signed-in device.
 *
 * Content crosses the port as plaintext: the server seals it at rest with its
 * External Key Manager, so the client holds no keys and runs no crypto worker.
 * No plaintext or token is ever logged here.
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
  /**
   * Live page of root messages, walking backwards from the newest when `cursor`
   * is `null` or from `cursor` when loading older history. Unlike the plain
   * `watchMessages` subscription this exposes `isDone`/`continueCursor`, so the
   * viewer can walk history page by page instead of re-requesting a growing
   * window on every scroll (which re-decrypts and re-sends the whole history).
   */
  watchChannelMessages(
    channelId: string,
    onChange: (page: Paginated<MessagePayload>) => void,
    options?: { readonly limit?: number; readonly cursor?: string | null },
  ): () => void;
}

export interface CreateChatRuntimeOptions {
  readonly client: ConvexReactClient;
  readonly userId: string;
  readonly displayName: string;
}

/** Builds the session for one signed-in device. */
export async function createChatRuntime(options: CreateChatRuntimeOptions): Promise<ChatRuntime> {
  const port = convexPort(options.client);
  const subscriptions: Subscriptions = convexSubscriptions(options.client);
  const session = ChatSession.create({ port, subscriptions });
  await session.start();
  await port.upsertDevice({ platform: isDesktop() ? "desktop" : "web" }).catch(() => undefined);

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

  function watchChannelMessages(
    channelId: string,
    onChange: (page: Paginated<MessagePayload>) => void,
    watchOptions: { readonly limit?: number; readonly cursor?: string | null } = {},
  ): () => void {
    const watch = options.client.watchQuery(api.messages.list, {
      channelId: channelId as never,
      paginationOpts: {
        numItems: watchOptions.limit ?? 100,
        cursor: watchOptions.cursor ?? null,
      },
    });
    const unsubscribe = watch.onUpdate(() => {
      const value = watch.localQueryResult();
      if (value !== undefined) {
        onChange(value);
      }
    });
    return () => {
      unsubscribe();
    };
  }

  return {
    session,
    port,
    subscriptions,
    client: options.client,
    watchThread,
    watchChannelMessages,
  };
}

export type { ChannelSummary };
