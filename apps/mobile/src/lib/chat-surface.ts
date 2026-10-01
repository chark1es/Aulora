import type { ChatPort, ChatSession, ChatSubscriptions, MessagePayload } from "@aulora/core";

/** Chat rendering and interactions, independent of the server transport. */
export interface ChatSurfaceRuntime {
  readonly session: ChatSession;
  readonly port: ChatPort;
  readonly subscriptions: ChatSubscriptions;
  watchHistory?(
    channelId: string,
    cursor: string | null,
    onChange: (page: {
      readonly messages: readonly MessagePayload[];
      readonly cursor: string;
      readonly isDone: boolean;
    }) => void,
  ): () => void;
  watchThread(
    threadRootId: string,
    onChange: (messages: readonly MessagePayload[]) => void,
  ): () => void;
}
