import {
  type AttachmentDescriptor,
  type MentionTarget,
  type MessagePayload,
  Permission,
  type RoleMentionTarget,
} from "@aulora/core";
import { Button, Heading, Spinner, Text } from "@aulora/ui-web";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { uploadFiles } from "../../lib/attachments";
import { useChannelSession } from "../../lib/use-channel";
import { type ChatSearchHit, useChat } from "../../providers/ChatProvider";
import { ChannelSidebar } from "./ChannelSidebar";
import { Composer } from "./Composer";
import { MembersPanel } from "./MembersPanel";
import { MessageList } from "./MessageList";
import { SearchPanel } from "./SearchPanel";
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
 * The signed-in chat surface: sidebar, message list, composer, threads,
 * members, local search and the offline outbox. Reads the MLS session from
 * {@link useChat} and keeps every payload decrypted through it.
 */
export function ChatView({ workspaceName, ownUserId, permissions, members, roles }: ChatViewProps) {
  const {
    runtime,
    channels,
    presence,
    reportChannelNames,
    ready,
    online,
    outbox,
    sendMessage,
    search,
  } = useChat();
  const [activeChannelId, setActiveChannelId] = useState<string | undefined>(undefined);
  const [threadRoot, setThreadRoot] = useState<MessagePayload | null>(null);
  const [customStatuses, setCustomStatuses] = useState<ReadonlyMap<string, string>>(new Map());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<readonly ChatSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
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
      .filter(
        (channel) =>
          channel.nameCiphertext !== null &&
          channel.nameCiphertext.length > 0 &&
          !reported.current.has(`${channel.id}:${channel.nameCiphertext}`),
      )
      .map((channel) => ({
        id: channel.id,
        ciphertext: channel.nameCiphertext as string,
        key: `${channel.id}:${channel.nameCiphertext}`,
      }));
    if (pending.length === 0) {
      return;
    }
    for (const entry of pending) {
      reported.current.add(entry.key);
    }
    reportChannelNames(pending.map(({ id, ciphertext }) => ({ id, ciphertext })));
  }, [runtime, channels, reportChannelNames]);

  useEffect(() => {
    if (runtime === undefined) {
      return;
    }
    const statusChannelId = activeChannelId;
    if (statusChannelId === undefined) {
      return;
    }
    for (const row of presence) {
      if (row.customStatusCiphertext !== null) {
        void runtime.session
          .decryptPayload<{ text: string }>(statusChannelId, row.customStatusCiphertext)
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
  }, [runtime, presence, activeChannelId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }
    const trimmed = searchQuery.trim();
    if (trimmed.length === 0) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void search(trimmed).then((hits) => {
        setSearchResults(hits);
        setSearching(false);
      });
    }, 120);
    return () => clearTimeout(timer);
  }, [searchOpen, searchQuery, search]);

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

  const pendingItems = useMemo(
    () => outbox.filter((item) => item.channelId === activeChannelId),
    [outbox, activeChannelId],
  );

  const pendingMessages = useMemo<readonly MessagePayload[]>(
    () =>
      pendingItems.map((item) => ({
        id: `pending:${item.id}`,
        channelId: item.channelId,
        authorId: ownUserId,
        authorDeviceId: null,
        ciphertext: "",
        epoch: 0,
        threadRootId: item.threadRootId ?? null,
        attachmentIds: [],
        mentionUserIds: [...item.mentionUserIds],
        editedAt: null,
        deletedAt: null,
        pinnedAt: null,
        createdAt: item.createdAt,
      })),
    [pendingItems, ownUserId],
  );

  const mergedMessages = useMemo(
    () => [...sessionState.messages, ...pendingMessages],
    [sessionState.messages, pendingMessages],
  );

  const mergedDecrypted = useMemo(() => {
    const next = new Map(sessionState.decrypted);
    for (const item of pendingItems) {
      next.set(`pending:${item.id}`, item.text);
    }
    return next;
  }, [sessionState.decrypted, pendingItems]);

  const attachmentsByMessage = useMemo(() => {
    const map = new Map<string, readonly AttachmentDescriptor[]>();
    if (runtime !== undefined) {
      for (const message of sessionState.messages) {
        const list = runtime.session.attachmentsFor(message.id);
        if (list.length > 0) {
          map.set(message.id, list);
        }
      }
    }
    for (const item of pendingItems) {
      if (item.attachments !== undefined && item.attachments.length > 0) {
        map.set(`pending:${item.id}`, item.attachments);
      }
    }
    return map;
  }, [runtime, sessionState.messages, pendingItems]);

  const pendingIds = useMemo(
    () => new Set(pendingItems.map((item) => `pending:${item.id}`)),
    [pendingItems],
  );

  const openChannel = useCallback(
    async (channelId: string) => {
      setActiveChannelId(channelId);
      setThreadRoot(null);
      const summary = channels.find((entry) => entry.id === channelId);
      if (runtime !== undefined && summary !== undefined) {
        await runtime.session.openChannel(summary);
        // The group is now open, so a name encrypted at an earlier epoch (or
        // re-encrypted for this member) can be retried even if an earlier
        // attempt ran before the Welcome arrived.
        if (summary.nameCiphertext !== null && summary.nameCiphertext.length > 0) {
          reportChannelNames([{ id: summary.id, ciphertext: summary.nameCiphertext }]);
        }
      }
    },
    [runtime, channels, reportChannelNames],
  );

  const selectSearchHit = useCallback(
    (hit: ChatSearchHit) => {
      setSearchOpen(false);
      void openChannel(hit.channelId).then(() => {
        setTimeout(() => {
          document.getElementById(`message-${hit.messageId}`)?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }, 120);
      });
    },
    [openChannel],
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
    <div className="relative flex h-screen min-h-0">
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
          void createChannel(runtime, name, kind).then((channelId) => {
            if (channelId !== undefined) {
              setActiveChannelId(channelId);
            }
          });
        }}
        onCreateDm={(userId) => {
          void createDm(runtime, userId).then((channelId) => {
            if (channelId !== undefined) {
              setActiveChannelId(channelId);
            }
          });
        }}
      />

      <main className="flex min-w-0 flex-1 flex-col bg-bg">
        {(!online || outbox.length > 0) && (
          <div
            data-testid="reconnecting"
            className="flex items-center gap-2 border-b border-border bg-accent-soft px-4 py-1"
          >
            <Spinner size={16} label="Reconnecting" />
            <Text size="xs" tone="accent">
              {online ? "Sending queued messages…" : "Reconnecting…"}
            </Text>
          </div>
        )}
        {channel === undefined ? (
          <div className="flex flex-1 items-center justify-center">
            <Text tone="muted">Select a channel to start.</Text>
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-3">
                <Heading level={3}>{channel.name}</Heading>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Search messages"
                  onClick={() => setSearchOpen(true)}
                >
                  Search
                </Button>
              </div>
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
              messages={mergedMessages}
              decrypted={mergedDecrypted}
              attachments={attachmentsByMessage}
              pendingIds={pendingIds}
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
              onSend={async ({ text, mentionUserIds, files }) => {
                let attachments: readonly AttachmentDescriptor[] | undefined;
                if (files.length > 0) {
                  try {
                    attachments = await uploadFiles(runtime.port, files);
                  } catch {
                    return;
                  }
                }
                const result = await sendMessage(channel.id, text, {
                  mentionUserIds,
                  ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
                });
                if (!result.queued && result.messageId !== undefined) {
                  void runtime.session.markRead(channel.id, result.messageId);
                }
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
              await sendMessage(channel.id, text, {
                mentionUserIds,
                threadRootId: threadRoot.id,
              });
            } else {
              const result = await sendMessage(channel.id, text, { mentionUserIds });
              if (!result.queued && result.messageId !== undefined) {
                void runtime.session.markRead(channel.id, result.messageId);
              }
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

      {searchOpen && (
        <SearchPanel
          query={searchQuery}
          results={searchResults}
          searching={searching}
          onQueryChange={setSearchQuery}
          onSelect={selectSearchHit}
          onClose={() => setSearchOpen(false)}
        />
      )}
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
): Promise<string | undefined> {
  // Create without a group id, then let the creator bootstrap derive the
  // deterministic group id and publish it.
  const channelId = await runtime.port.createChannel({ kind, nameCiphertext: "" });
  await runtime.session.openChannel({
    id: channelId,
    kind,
    categoryId: null,
    nameCiphertext: "",
    topicCiphertext: null,
    mlsGroupId: null,
    archived: false,
    currentEpoch: null,
  });
  await runtime.session.setChannelName(channelId, name);
  return channelId;
}

async function createDm(
  runtime: NonNullable<ReturnType<typeof useChat>["runtime"]>,
  userId: string,
): Promise<string | undefined> {
  // DMs need a group; create it, then let the creator bootstrap the group and
  // publish its id.
  const { channelId } = await runtime.port.createDm({ otherUserId: userId });
  await runtime.session.openChannel({
    id: channelId,
    kind: "dm",
    categoryId: null,
    nameCiphertext: null,
    topicCiphertext: null,
    mlsGroupId: null,
    archived: false,
    currentEpoch: null,
  });
  return channelId;
}

export { Permission };
