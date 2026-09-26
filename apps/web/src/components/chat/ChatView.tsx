import {
  type MentionTarget,
  type MessagePayload,
  Permission,
  type RoleMentionTarget,
} from "@aulora/core";
import { Heading, Spinner, Text } from "@aulora/ui-web";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChannelSession } from "../../lib/use-channel";
import { useChat } from "../../providers/ChatProvider";
import { ChannelSidebar } from "./ChannelSidebar";
import { Composer } from "./Composer";
import { MembersPanel } from "./MembersPanel";
import { MessageList } from "./MessageList";
import { ThreadsPanel } from "./ThreadsPanel";

export interface ChatViewProps {
  readonly workspaceName: string;
  readonly ownUserId: string;
  readonly permissions: bigint;
  readonly members: readonly {
    userId: string;
    displayName: string;
    roleIds?: readonly string[];
    isOwner?: boolean;
  }[];
  readonly roles: readonly RoleMentionTarget[];
}

/**
 * The signed-in chat surface: sidebar, message list, composer, threads and
 * members. Reads the MLS session from {@link useChat} and keeps every payload
 * decrypted through it.
 */
export function ChatView({ workspaceName, ownUserId, permissions, members, roles }: ChatViewProps) {
  const { runtime, channels, presence, reportChannelNames, ready } = useChat();
  const [activeChannelId, setActiveChannelId] = useState<string | undefined>(undefined);
  const [threadRoot, setThreadRoot] = useState<MessagePayload | null>(null);
  const [customStatuses, setCustomStatuses] = useState<ReadonlyMap<string, string>>(new Map());
  const reported = useRef(new Set<string>());

  useEffect(() => {
    if (activeChannelId === undefined && channels.length > 0) {
      setActiveChannelId(channels[0]?.id);
    }
  }, [channels, activeChannelId]);

  useEffect(() => {
    if (runtime === undefined) {
      return;
    }
    const pending = channels
      .filter((channel) => channel.nameCiphertext !== null && !reported.current.has(channel.id))
      .map((channel) => ({ id: channel.id, ciphertext: channel.nameCiphertext as string }));
    if (pending.length === 0) {
      return;
    }
    for (const entry of pending) {
      reported.current.add(entry.id);
    }
    reportChannelNames(pending);
  }, [runtime, channels, reportChannelNames]);

  useEffect(() => {
    if (runtime === undefined) {
      return;
    }
    for (const row of presence) {
      if (row.customStatusCiphertext !== null) {
        void runtime.session
          .decryptPayload<{ text: string }>(row.customStatusCiphertext)
          .then((payload) => {
            if (payload !== undefined) {
              setCustomStatuses((current) => {
                const next = new Map(current);
                next.set(row.userId, payload.text);
                return next;
              });
            }
          });
      }
    }
  }, [runtime, presence]);

  const channel = channels.find((entry) => entry.id === activeChannelId);
  const sessionState = useChannelSession(runtime, activeChannelId, ownUserId);

  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      map.set(member.userId, member.displayName);
    }
    return map;
  }, [members]);

  const mentionMembers: readonly MentionTarget[] = useMemo(
    () =>
      members.map((member) => ({
        userId: member.userId,
        displayName: member.displayName,
        ...(member.roleIds !== undefined ? { roleIds: member.roleIds } : {}),
      })),
    [members],
  );

  const memberIds = useMemo(() => members.map((member) => member.userId), [members]);

  const unreadByChannel = useMemo(() => {
    const map = new Map<string, { mentions: number; unread: boolean }>();
    if (activeChannelId !== undefined && sessionState.unread.unread) {
      map.set(activeChannelId, {
        mentions: sessionState.unread.mentionCount,
        unread: true,
      });
    }
    return map;
  }, [activeChannelId, sessionState.unread]);

  const openChannel = useCallback(
    async (channelId: string) => {
      setActiveChannelId(channelId);
      setThreadRoot(null);
      const summary = channels.find((entry) => entry.id === channelId);
      if (runtime !== undefined && summary !== undefined) {
        await runtime.session.openChannel(summary);
      }
    },
    [runtime, channels],
  );

  if (!ready || runtime === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3">
        <Spinner size={28} label="Opening encrypted channels" />
        <Text tone="muted" size="sm">
          Opening encrypted channels…
        </Text>
      </div>
    );
  }

  return (
    <div className="flex h-screen min-h-0">
      <ChannelSidebar
        workspaceName={workspaceName}
        channels={channels}
        activeChannelId={activeChannelId}
        unreadByChannel={unreadByChannel}
        members={members.map((member) => ({
          userId: member.userId,
          displayName: member.displayName,
        }))}
        onSelect={(channelId) => void openChannel(channelId)}
        onCreateChannel={({ name, kind }) => {
          void createChannel(runtime, name, kind);
        }}
        onCreateDm={(userId) => {
          void createDm(runtime, userId);
        }}
      />

      <main className="flex min-w-0 flex-1 flex-col bg-bg">
        {channel === undefined ? (
          <div className="flex flex-1 items-center justify-center">
            <Text tone="muted">Select a channel to start.</Text>
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <Heading level={3}>{channel.name}</Heading>
              <Text size="xs" tone="secondary" mono>
                E2EE · epoch{" "}
                {sessionState.messages.length > 0
                  ? (sessionState.messages[sessionState.messages.length - 1]?.epoch ?? 0)
                  : 0}
              </Text>
            </header>
            <MessageList
              runtime={runtime}
              channelId={channel.id}
              messages={sessionState.messages}
              decrypted={sessionState.decrypted}
              permissions={permissions}
              ownUserId={ownUserId}
              memberNames={memberNames}
              firstUnreadId={sessionState.unread.firstUnreadId}
              onReply={(message) => setThreadRoot(message)}
              onEdit={(message, text) => {
                void runtime.session.editMessage(channel.id, message.id, text);
              }}
              onDelete={(message) => {
                void runtime.session.deleteMessage(channel.id, message.id);
              }}
              onPinToggle={(message) => {
                void (message.pinnedAt !== null
                  ? runtime.session.unpinMessage(channel.id, message.id)
                  : runtime.session.pinMessage(channel.id, message.id));
              }}
              onReact={(message, emoji) => {
                void runtime.session.toggleReaction(channel.id, message.id, emoji);
              }}
              onJumpToFirstUnread={() => {
                if (sessionState.unread.firstUnreadId !== null) {
                  void runtime.session.markRead(channel.id, sessionState.unread.firstUnreadId);
                }
              }}
            />
            <div className="px-4 pb-1">
              {sessionState.typers.length > 0 && (
                <Text size="xs" tone="muted">
                  {sessionState.typers.length} typing…
                </Text>
              )}
            </div>
            <Composer
              channelId={channel.id}
              members={mentionMembers}
              roles={roles}
              memberIds={memberIds}
              onTyping={(channelId) => {
                void runtime.port.setTyping({ channelId });
              }}
              onSend={async ({ text, mentionUserIds }) => {
                const messageId = await runtime.session.sendMessage(channel.id, text, {
                  mentionUserIds,
                });
                await runtime.session.markRead(channel.id, messageId);
              }}
            />
          </>
        )}
      </main>

      {threadRoot !== null && channel !== undefined && (
        <ThreadsPanel
          runtime={runtime}
          channelId={channel.id}
          root={threadRoot}
          rootText={sessionState.decrypted.get(threadRoot.id)}
          members={mentionMembers}
          roles={roles}
          memberIds={memberIds}
          ownUserId={ownUserId}
          memberNames={memberNames}
          onClose={() => setThreadRoot(null)}
          onTyping={(channelId) => {
            void runtime.port.setTyping({ channelId });
          }}
          onSendReply={async ({ text, mentionUserIds, replyInThread }) => {
            if (replyInThread) {
              await runtime.session.sendMessage(channel.id, text, {
                mentionUserIds,
                threadRootId: threadRoot.id,
              });
            } else {
              const messageId = await runtime.session.sendMessage(channel.id, text, {
                mentionUserIds,
              });
              await runtime.session.markRead(channel.id, messageId);
            }
          }}
        />
      )}

      <MembersPanel
        members={members}
        presence={presence}
        customStatuses={customStatuses}
        onSetStatus={(status) => {
          void runtime.port.setStatus({ status });
        }}
      />
    </div>
  );
}

/**
 * Creates a channel: the deterministic group id is derived from the channel id
 * the server returns, so the creator then opens the group and encrypts the name
 * at epoch 0.
 */
async function createChannel(
  runtime: NonNullable<ReturnType<typeof useChat>["runtime"]>,
  name: string,
  kind: "text" | "announcement",
): Promise<void> {
  const { channelGroupId, encodeMlsBytes } = await import("@aulora/core");
  // The channel is created with a placeholder group id, then the real
  // deterministic id is set while the group opens; both are ciphertext-free.
  const provisional = encodeMlsBytes(new TextEncoder().encode(`pending:${Date.now()}`));
  const channelId = await runtime.port.createChannel({
    kind,
    nameCiphertext: "",
    mlsGroupId: provisional,
  });
  const realGroupId = encodeMlsBytes(channelGroupId(channelId));
  await runtime.port.setMlsGroupId({ channelId, mlsGroupId: realGroupId });
  const summary = {
    id: channelId,
    kind,
    categoryId: null,
    nameCiphertext: "",
    topicCiphertext: null,
    mlsGroupId: realGroupId,
    archived: false,
    currentEpoch: null,
  } as const;
  await runtime.session.openChannel(summary);
  const nameCiphertext = await runtime.session.encryptPayload(channelId, { text: name });
  await runtime.port.renameChannel({ channelId, nameCiphertext });
}

async function createDm(
  runtime: NonNullable<ReturnType<typeof useChat>["runtime"]>,
  userId: string,
): Promise<void> {
  const { channelGroupId, encodeMlsBytes } = await import("@aulora/core");
  // DMs need a group; the deterministic id is derived from the channel id after
  // creation, so create then set the group id and open.
  const provisional = encodeMlsBytes(new TextEncoder().encode(`pending:${Date.now()}`));
  const { channelId } = await runtime.port.createDm({
    otherUserId: userId,
    mlsGroupId: provisional,
  });
  const realGroupId = encodeMlsBytes(channelGroupId(channelId));
  await runtime.port.setMlsGroupId({ channelId, mlsGroupId: realGroupId });
  await runtime.session.openChannel({
    id: channelId,
    kind: "dm",
    categoryId: null,
    nameCiphertext: null,
    topicCiphertext: null,
    mlsGroupId: realGroupId,
    archived: false,
    currentEpoch: null,
  });
}

export { Permission };
