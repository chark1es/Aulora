import type { MessagePayload, OutboxItem, RoleMentionTarget } from "@aulora/core";
import {
  type AttachmentDescriptor,
  canUseMassMentions,
  hasPermission,
  Permission,
} from "@aulora/core";
import { Icon, Text, usePalette } from "@aulora/ui-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import type { PickedFile } from "../../lib/attachments";
import type { ChatSurfaceRuntime } from "../../lib/chat-surface";
import { watchThreadFeed } from "../../lib/thread-feed";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { SlideOver } from "./SlideOver";

export interface ThreadModalProps {
  readonly channelKind?: string;
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
  readonly onChannelPress?: (_name: string) => void;
  /** Where the thread lives, shown under the title. */
  readonly channelTitle?: string;
  readonly audienceSize?: number;
  readonly permissions?: bigint;
  readonly onClose: () => void;
  readonly onSendReply: (_input: {
    text: string;
    files: readonly PickedFile[];
    replyInThread: boolean;
  }) => void | Promise<void>;
}

/** A thread as its own page: the root message, its replies and an in-thread composer. */
export function ThreadModal(props: ThreadModalProps) {
  const {
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
  } = props;
  const loadMore = useRef<() => void>(() => undefined);
  const [pageStatus, setPageStatus] = useState({ loading: true, error: false });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [replies, setReplies] = useState<readonly MessagePayload[]>([]);
  const [decrypted, setDecrypted] = useState<ReadonlyMap<string, string>>(new Map());
  const palette = usePalette();
  // The root carries the server’s true reply count; loaded replies are a
  // fallback for older servers that do not send it.
  const replyCount = root.replyCount ?? replies.length;
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
        mentionEveryone: item.mentionEveryone ?? false,
        mentionHere: item.mentionHere ?? false,
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
    setReplies([]);
    setDecrypted(new Map());
    setNextCursor(null);
    const feed = watchThreadFeed(
      runtime,
      root.id,
      (incoming) => {
        setReplies(incoming);
        setDecrypted(
          new Map(incoming.map((reply) => [reply.id, runtime.session.decryptedText(reply.id)])),
        );
      },
      setNextCursor,
      setPageStatus,
    );
    loadMore.current = feed.loadMore;
    return feed.stop;
  }, [runtime, root.id]);

  return (
    <SlideOver
      title="Thread"
      subtitle={
        channelTitle === undefined
          ? undefined
          : `${channelTitle} · ${replyCount} ${replyCount === 1 ? "reply" : "replies"}`
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
      {(nextCursor !== null || replies.length < replyCount) && (
        <Text size="xs" tone="muted" className="px-4 pt-2" numberOfLines={1}>
          Showing {replies.length} of {replyCount} replies
        </Text>
      )}
      {pageStatus.loading ? (
        <Text size="sm" tone="muted" accessibilityRole="progressbar" className="px-4 py-3">
          Loading replies…
        </Text>
      ) : pageStatus.error ? (
        <View className="gap-1 px-4 py-3">
          <Text tone="danger" accessibilityRole="alert">
            Couldn’t load replies.
          </Text>
          <Pressable accessibilityRole="button" onPress={() => loadMore.current()}>
            <Text tone="accent">Retry</Text>
          </Pressable>
        </View>
      ) : (
        nextCursor !== null && (
          <Pressable
            accessibilityRole="button"
            onPress={() => loadMore.current()}
            className="px-4 py-3"
          >
            <Text tone="accent">Load more replies</Text>
          </Pressable>
        )
      )}
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
        key={`${channelId}:${root.id}`}
        channelId={channelId}
        disabled={
          !hasPermission(permissions, Permission.SendMessages) ||
          !hasPermission(permissions, Permission.SendInThreads)
        }
        canMentionEveryone={canUseMassMentions(
          { kind: props.channelKind ?? "text" },
          alsoSend ? undefined : root.id,
          permissions,
        )}
        massMentionHint={
          alsoSend
            ? "Only members with permission can notify everyone in the channel copy."
            : "Notifying everyone isn't available in thread replies."
        }
        audienceSize={props.audienceSize ?? 0}
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
        onClearTyping={(id) => {
          void runtime.port.clearTyping({ channelId: id });
        }}
        onSend={(input) =>
          onSendReply({ text: input.text, files: input.files, replyInThread: !alsoSend })
        }
      />
    </SlideOver>
  );
}
