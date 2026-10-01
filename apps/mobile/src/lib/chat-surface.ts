import type { ChatPort, ChatSession, ChatSubscriptions, MessagePayload } from "@aulora/core";

/** Chat rendering and interactions, independent of the server transport. */
export interface ChatSurfaceRuntime {
  readonly session: ChatSession;
  readonly port: ChatPort;
  readonly subscriptions: ChatSubscriptions;
  watchThread(
    threadRootId: string,
    onChange: (messages: readonly MessagePayload[]) => void,
  ): () => void;
}
