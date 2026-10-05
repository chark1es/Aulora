/**
 * Subscription hub for the chat mock.
 *
 * Owns the in-memory listener registry and emits the watch callbacks, so
 * `createMockPort` stays focused on the port methods and the file stays within
 * the analyser's size limits.
 */

import type {
  ChannelSummary,
  ChatSubscriptions,
  MessagePayload,
  PresenceRow,
  ReactionRow,
  ReadStateRow,
  StoredFileView,
  TypingRow,
} from "./port.js";

export interface MockPortState {
  readonly calls: { method: string; args: unknown }[];
  readonly channels: Map<string, ChannelSummary>;
  readonly messages: Map<string, MessagePayload>;
  readonly reactions: Map<string, ReactionRow[]>;
  readonly presence: PresenceRow[];
  readonly typing: Map<string, TypingRow[]>;
  readonly readStates: Map<string, ReadStateRow>;
  readonly members: Map<string, string[]>;
  readonly files: Map<string, StoredFileView>;
  /** Plaintext bytes by file id (the mock's "sealed at rest" storage). */
  readonly blobs: Map<string, Uint8Array>;
  deviceId: string;
}

/** Builds the watch/subscription half of a mock port over shared `state`. */
export function createMockHub(state: MockPortState) {
  const channelListeners: ((channels: readonly ChannelSummary[]) => void)[] = [];
  const messageListeners = new Map<string, ((messages: readonly MessagePayload[]) => void)[]>();
  const reactionListeners = new Map<string, ((reactions: readonly ReactionRow[]) => void)[]>();
  const presenceListeners: ((presence: readonly PresenceRow[]) => void)[] = [];
  const typingListeners = new Map<string, ((typers: readonly TypingRow[]) => void)[]>();
  const readStateListeners = new Map<string, ((state: ReadStateRow | null) => void)[]>();

  const emitChannels = (): void => {
    const list = [...state.channels.values()];
    for (const listener of channelListeners) {
      listener(list);
    }
  };

  const emitMessages = (channelId: string): void => {
    const list = [...state.messages.values()]
      .filter((message) => message.channelId === channelId && message.threadRootId === null)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const listener of messageListeners.get(channelId) ?? []) {
      listener(list);
    }
  };

  const emitTyping = (channelId: string): void => {
    for (const listener of typingListeners.get(channelId) ?? []) {
      listener(state.typing.get(channelId) ?? []);
    }
  };

  const emitReactions = (messageId: string, rows: readonly ReactionRow[]): void => {
    state.reactions.set(messageId, [...rows]);
    for (const listener of reactionListeners.get(messageId) ?? []) {
      listener(rows);
    }
  };

  const emitPresence = (): void => {
    for (const listener of presenceListeners) {
      listener(state.presence);
    }
  };

  const emitReadState = (channelId: string, row: ReadStateRow): void => {
    for (const listener of readStateListeners.get(channelId) ?? []) {
      listener(row);
    }
  };

  const subscriptions: ChatSubscriptions = {
    watchChannels(onChange) {
      channelListeners.push(onChange);
      onChange([...state.channels.values()]);
      return () => {
        const index = channelListeners.indexOf(onChange);
        if (index >= 0) {
          channelListeners.splice(index, 1);
        }
      };
    },
    watchMessages(channelId, onChange, options) {
      // Like the server: the newest `limit` roots, oldest first.
      const limit = options?.limit;
      const listener = (messages: readonly MessagePayload[]) => {
        onChange(limit === undefined ? messages : messages.slice(-limit));
      };
      const list = messageListeners.get(channelId) ?? [];
      list.push(listener);
      messageListeners.set(channelId, list);
      listener(
        [...state.messages.values()]
          .filter((message) => message.channelId === channelId && message.threadRootId === null)
          .sort((a, b) => a.createdAt - b.createdAt),
      );
      return () => {
        messageListeners.set(
          channelId,
          (messageListeners.get(channelId) ?? []).filter((entry) => entry !== listener),
        );
      };
    },
    watchReactions(messageId, onChange) {
      const list = reactionListeners.get(messageId) ?? [];
      list.push(onChange);
      reactionListeners.set(messageId, list);
      onChange(state.reactions.get(messageId) ?? []);
      return () => {
        reactionListeners.set(
          messageId,
          (reactionListeners.get(messageId) ?? []).filter((listener) => listener !== onChange),
        );
      };
    },
    watchReactionsBatch(messageIds, onChange) {
      const unique = [...new Set(messageIds)];
      const emit = () => {
        onChange(
          unique.flatMap((messageId) =>
            (state.reactions.get(messageId) ?? []).map((reaction) => ({
              messageId,
              ...reaction,
            })),
          ),
        );
      };
      const registered = new Map<string, () => void>();
      for (const messageId of unique) {
        const listener = () => {
          emit();
        };
        const list = reactionListeners.get(messageId) ?? [];
        list.push(listener);
        reactionListeners.set(messageId, list);
        registered.set(messageId, listener);
      }
      emit();
      return () => {
        for (const [messageId, listener] of registered) {
          reactionListeners.set(
            messageId,
            (reactionListeners.get(messageId) ?? []).filter((entry) => entry !== listener),
          );
        }
      };
    },
    watchPresence(onChange) {
      presenceListeners.push(onChange);
      onChange(state.presence);
      return () => {
        const index = presenceListeners.indexOf(onChange);
        if (index >= 0) {
          presenceListeners.splice(index, 1);
        }
      };
    },
    watchTyping(channelId, onChange) {
      const list = typingListeners.get(channelId) ?? [];
      list.push(onChange);
      typingListeners.set(channelId, list);
      onChange(state.typing.get(channelId) ?? []);
      return () => {
        typingListeners.set(
          channelId,
          (typingListeners.get(channelId) ?? []).filter((listener) => listener !== onChange),
        );
      };
    },
    watchReadState(channelId, onChange) {
      const list = readStateListeners.get(channelId) ?? [];
      list.push(onChange);
      readStateListeners.set(channelId, list);
      onChange(state.readStates.get(channelId) ?? null);
      return () => {
        readStateListeners.set(
          channelId,
          (readStateListeners.get(channelId) ?? []).filter((listener) => listener !== onChange),
        );
      };
    },
  };

  return {
    subscriptions,
    emitChannels,
    emitMessages,
    emitTyping,
    emitReactions,
    emitPresence,
    emitReadState,
  };
}
