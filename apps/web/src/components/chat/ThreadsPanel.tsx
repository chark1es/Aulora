import { Avatar, userAvatarSeed } from "@aulora/avatars";
import type { MentionTarget, MessagePayload, RoleMentionTarget } from "@aulora/core";
import { IconButton, Text } from "@aulora/ui-web";
import { useEffect, useState } from "react";
import type { ChatRuntime } from "../../lib/chat-runtime";
import { Composer } from "./Composer";

export interface ThreadsPanelProps {
  readonly runtime: ChatRuntime | undefined;
  readonly channelId: string;
  readonly root: MessagePayload;
  readonly rootText: string | undefined;
  readonly members: readonly MentionTarget[];
  readonly roles: readonly RoleMentionTarget[];
  readonly memberIds: readonly string[];
  readonly ownUserId: string;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly onClose: () => void;
  readonly onTyping: (channelId: string) => void;
  readonly onSendReply: (input: {
    text: string;
    mentionUserIds: readonly string[];
    replyInThread: boolean;
  }) => void | Promise<void>;
}

/** Side panel showing one thread's replies with a reply composer. */
export function ThreadsPanel({
  runtime,
  channelId,
  root,
  rootText,
  members,
  roles,
  memberIds,
  ownUserId,
  memberNames,
  onClose,
  onTyping,
  onSendReply,
}: ThreadsPanelProps) {
  const [replies, setReplies] = useState<readonly MessagePayload[]>([]);
  const [decrypted, setDecrypted] = useState<ReadonlyMap<string, string>>(new Map());
  const [alsoSend, setAlsoSend] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-subscribe only when the root/runtime changes
  useEffect(() => {
    if (runtime === undefined) {
      return;
    }
    let cancelled = false;
    const offThread = watchThread(runtime, root.id, (incoming) => {
      void runtime.session.receiveMessages(incoming).then(() => {
        if (cancelled) {
          return;
        }
        setReplies(incoming);
        setDecrypted((current) => {
          const next = new Map(current);
          for (const reply of incoming) {
            const text = runtime.session.decryptedText(reply.id);
            if (text !== undefined) {
              next.set(reply.id, text);
            }
          }
          return next;
        });
      });
    });
    return () => {
      cancelled = true;
      offThread();
    };
  }, [runtime, channelId, root.id]);

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-surface-1">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <Text size="sm" mono>
          THREAD
        </Text>
        <IconButton size="sm" label="Close thread" onClick={onClose}>
          <span aria-hidden="true">×</span>
        </IconButton>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <ThreadMessage
          message={root}
          text={rootText}
          authorName={memberNames.get(root.authorId) ?? root.authorId}
          ownUserId={ownUserId}
        />
        <div className="h-px bg-border" />
        {replies.map((reply) => (
          <ThreadMessage
            key={reply.id}
            message={reply}
            text={decrypted.get(reply.id)}
            authorName={memberNames.get(reply.authorId) ?? reply.authorId}
            ownUserId={ownUserId}
          />
        ))}
        {replies.length === 0 && (
          <Text size="sm" tone="muted">
            No replies yet.
          </Text>
        )}
      </div>

      <label className="flex items-center gap-2 px-3 py-1 text-xs text-text-muted">
        <input
          type="checkbox"
          checked={alsoSend}
          onChange={(event) => setAlsoSend(event.target.checked)}
        />
        Also send to channel
      </label>
      <Composer
        channelId={channelId}
        members={members}
        roles={roles}
        memberIds={memberIds}
        placeholder="Reply"
        onTyping={onTyping}
        onSend={(input) =>
          onSendReply({
            text: input.text,
            mentionUserIds: input.mentionUserIds,
            replyInThread: !alsoSend,
          })
        }
        threadHint="Replying in thread"
      />
    </aside>
  );
}

function ThreadMessage({
  message,
  text,
  authorName,
  ownUserId,
}: {
  message: MessagePayload;
  text: string | undefined;
  authorName: string;
  ownUserId: string;
}) {
  if (message.deletedAt !== null) {
    return (
      <Text size="sm" tone="muted" className="italic">
        Deleted.
      </Text>
    );
  }
  return (
    <div className="flex gap-2">
      <Avatar seed={userAvatarSeed(message.authorId)} size={24} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <Text size="sm" className="font-medium">
            {authorName}
            {message.authorId === ownUserId ? " (you)" : ""}
          </Text>
          <Text size="xs" tone="muted" mono>
            {new Date(message.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        </div>
        <Text size="sm" className="whitespace-pre-wrap break-words">
          {text ?? "Unable to decrypt this message."}
        </Text>
      </div>
    </div>
  );
}

function watchThread(
  runtime: ChatRuntime,
  rootId: string,
  onChange: (messages: readonly MessagePayload[]) => void,
): () => void {
  // Thread replies are fetched through the runtime's message subscription for
  // the root id. The adapter queries `messages.listThread` via a dedicated
  // path added in the web port; here we reuse the session's decryption.
  return runtime.watchThread(rootId, onChange);
}
