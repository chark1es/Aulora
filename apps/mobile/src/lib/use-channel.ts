import type {
  MessagePayload,
  PresenceRow,
  ReactionRow,
  ReadStateRow,
  TypingRow,
} from "@aulora/core";
import { summarizeUnread, type UnreadSummary } from "@aulora/core";
import { useEffect, useMemo, useState } from "react";
import type { MobileChatRuntime } from "./chat-runtime";

export interface ChannelSessionState {
  readonly messages: readonly MessagePayload[];
  readonly decrypted: ReadonlyMap<string, string>;
  readonly typers: readonly TypingRow[];
  readonly readState: ReadStateRow | null;
  readonly unread: UnreadSummary;
}

/**
 * Subscribes to one channel's live messages, typing and read state. The server
 * returns message bodies as plaintext, so no decryption happens here; the map
 * is just a stable id-to-text view for rendering. Mirrors the web hook so both
 * clients behave identically.
 */
export function useChannelSession(
  runtime: MobileChatRuntime | undefined,
  channelId: string | undefined,
  userId: string,
): ChannelSessionState {
  const [messages, setMessages] = useState<readonly MessagePayload[]>([]);
  const [decrypted, setDecrypted] = useState<ReadonlyMap<string, string>>(new Map());
  const [typers, setTypers] = useState<readonly TypingRow[]>([]);
  const [readState, setReadState] = useState<ReadStateRow | null>(null);

  useEffect(() => {
    if (runtime === undefined || channelId === undefined) {
      setMessages([]);
      setDecrypted(new Map());
      setTypers([]);
      setReadState(null);
      return;
    }
    const offMessages = runtime.subscriptions.watchMessages(channelId, (incoming) => {
      setMessages(incoming);
      void runtime.session.receiveMessages(incoming);
    });
    const offDecrypted = runtime.session.onDecrypted((opened) => {
      setDecrypted((current) => {
        const next = new Map(current);
        for (const message of opened) {
          if (message.channelId !== channelId) {
            continue;
          }
          next.set(message.id, runtime.session.decryptedText(message.id));
        }
        return next;
      });
    });
    const offTyping = runtime.subscriptions.watchTyping(channelId, setTypers);
    const offRead = runtime.subscriptions.watchReadState(channelId, setReadState);
    return () => {
      offMessages();
      offDecrypted();
      offTyping();
      offRead();
    };
  }, [runtime, channelId]);

  const unread = useMemo(
    () =>
      summarizeUnread(
        messages.map((message) => ({
          id: message.id,
          createdAt: message.createdAt,
          authorId: message.authorId,
          mentionedUserIds: message.mentionUserIds,
        })),
        {
          lastReadAt: null,
          lastReadMessageId: readState?.lastReadMessageId ?? null,
          mentionCount: readState?.mentionCount ?? 0,
        },
        userId,
      ),
    [messages, readState, userId],
  );

  return { messages, decrypted, typers, readState, unread };
}

export type { PresenceRow, ReactionRow };
