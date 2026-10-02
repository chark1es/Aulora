import type { MessagePayload, OutboxItem, RoleMentionTarget } from "@aulora/core";
import { type AttachmentDescriptor, hasPermission, Permission } from "@aulora/core";
import { Icon, Text, usePalette } from "@aulora/ui-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import type { PickedFile } from "../../lib/attachments";
import type { ChatSurfaceRuntime } from "../../lib/chat-surface";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { SlideOver } from "./SlideOver";

export interface ThreadModalProps {
  readonly runtime: ChatSurfaceRuntime;
  readonly channelId: string;
  readonly root: MessagePayload;
  readonly outbox?: readonly OutboxItem[];
  readonly rootText: string | undefined;
  readonly ownUserId: string;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly roles?: readonly RoleMentionTarget[];
  readonly channels?: readonly { readonly id: string; readonly name: string }[];
  /** Channel/category names `#` may refer to, for rendering. */
  readonly channelNames?: ReadonlyMap<string, string>;
  /** Opens the channel behind a `#channel` mention. */
  readonly onChannelPress?: (name: string) => void;
  /** Where the thread lives, shown under the title. */
  readonly channelTitle?: string;
  readonly permissions?: bigint;
  readonly onClose: () => void;
  readonly onSendReply: (input: {
    text: string;
    files: readonly PickedFile[];
    replyInThread: boolean;
  }) => void | Promise<void>;
}

/** A thread as its own page: the root message, its replies and an in-thread composer. */
export function ThreadModal({
  runtime,
  channelId,
  root,
  outbox = [],
  rootText,
  ownUserId,
  memberNames,
  roles = [],
  channels = [],
  channelNames,
  onChannelPress,
  channelTitle,
  permissions = 0n,
  onClose,
  onSendReply,
}: ThreadModalProps) {
  const [replies, setReplies] = useState<readonly MessagePayload[]>([]);
  const [decrypted, setDecrypted] = useState<ReadonlyMap<string, string>>(new Map());
  const palette = usePalette();
  const [alsoSend, setAlsoSend] = useState(false);
  const pending = useMemo(
    () => outbox.filter((item) => item.channelId === channelId && item.threadRootId === root.id),
    [outbox, channelId, root.id],
  );
  const messages = useMemo<readonly MessagePayload[]>(
    () => [
      root,
      ...replies,
      ...pending.map((item) => ({
        id: `pending:${item.id}`,
        channelId,
        authorId: ownUserId,
        body: item.text,
        threadRootId: root.id,
        replyToId: item.replyToId ?? null,
        attachmentIds: (item.attachments ?? []).map((file) => file.fileId),
        mentionUserIds: [...item.mentionUserIds],
        createdAt: item.createdAt,
        editedAt: null,
        deletedAt: null,
        pinnedAt: null,
      })),
    ],
    [root, replies, pending, channelId, ownUserId],
  );
  const texts = useMemo(
    () =>
      new Map([
        ...decrypted,
        [root.id, rootText ?? root.body],
        ...pending.map((item) => [`pending:${item.id}`, item.text] as const),
      ]),
    [decrypted, root.id, rootText, root.body, pending],
  );
  const attachments = useMemo(
    () =>
      new Map(
        messages.map((message) => [
          message.id,
          runtime.session.attachmentsFor(message.id) as readonly AttachmentDescriptor[],
        ]),
      ),
    [messages, runtime],
  );

  useEffect(() => {
    const off = runtime.watchThread(root.id, (incoming) => {
      void runtime.session.receiveMessages(incoming).then(() => {
        setReplies(incoming);
        setDecrypted((current) => {
          const next = new Map(current);
          for (const reply of incoming) {
            next.set(reply.id, runtime.session.decryptedText(reply.id));
          }
          return next;
        });
      });
    });
    return () => {
      off();
    };
  }, [runtime, root.id]);

  return (
    <SlideOver
      title="Thread"
      subtitle={
        channelTitle === undefined
          ? undefined
          : `${channelTitle} · ${replies.length} ${replies.length === 1 ? "reply" : "replies"}`
      }
      onClose={onClose}
    >
      <MessageList
        runtime={runtime}
        channelId={channelId}
        messages={messages}
        decrypted={texts}
        attachments={attachments}
        pendingIds={new Set(pending.map((item) => `pending:${item.id}`))}
        ownUserId={ownUserId}
        memberNames={memberNames}
        memberColors={new Map()}
        permissions={permissions}
        channelNames={channelNames}
        firstUnreadId={null}
        onChannelPress={onChannelPress}
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: alsoSend }}
        hitSlop={6}
        onPress={() => {
          setAlsoSend(!alsoSend);
        }}
        className="flex-row items-center gap-2 px-4 py-1.5"
      >
        <View
          className={`h-[18px] w-[18px] items-center justify-center rounded-sm border ${
            alsoSend ? "border-accent bg-accent" : "border-border"
          }`}
        >
          {alsoSend && <Icon name="check" size={14} color={palette["on-accent"]} />}
        </View>
        <Text size="xs" tone={alsoSend ? "accent" : "muted"}>
          Also send to {channelTitle ?? "the conversation"}
        </Text>
      </Pressable>
      <Composer
        channelId={channelId}
        disabled={
          !hasPermission(permissions, Permission.SendMessages) ||
          (!alsoSend && !hasPermission(permissions, Permission.SendInThreads))
        }
        placeholder="Reply in thread"
        members={[...memberNames.entries()].map(([userId, displayName]) => ({
          userId,
          displayName,
        }))}
        roles={roles}
        channels={channels}
        onTyping={(id) => {
          void runtime.port.setTyping({ channelId: id });
        }}
        onSend={(input) =>
          onSendReply({ text: input.text, files: input.files, replyInThread: !alsoSend })
        }
      />
    </SlideOver>
  );
}
