import type { AttachmentDescriptor, MessagePayload } from "@aulora/core";
import { Button, Heading, Spinner, Text } from "@aulora/ui-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { uploadPickedFiles } from "../../lib/attachments";
import { useLocalNotifications } from "../../lib/notifications";
import { typingLabel } from "../../lib/presence";
import { useChannelSession } from "../../lib/use-channel";
import { useChat } from "../../providers/ChatProvider";
import { Composer } from "./Composer";
import { MembersSheet } from "./MembersSheet";
import { MessageList } from "./MessageList";
import { ThreadModal } from "./ThreadModal";

export interface ChatScreenProps {
  readonly workspaceName: string;
  readonly ownUserId: string;
  readonly ownDisplayName: string;
  readonly onSignOut: () => void;
}

/**
 * The signed-in mobile chat surface: channel drawer, decrypted message list,
 * composer, threads, reactions, presence, typing and the E2EE status banner.
 */
export function ChatScreen({
  workspaceName,
  ownUserId,
  ownDisplayName,
  onSignOut,
}: ChatScreenProps) {
  const {
    runtime,
    mlsError,
    ready,
    channels,
    presence,
    outbox,
    channelNames,
    reportChannelNames,
    sendMessage,
  } = useChat();
  const [activeChannelId, setActiveChannelId] = useState<string | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [threadRoot, setThreadRoot] = useState<MessagePayload | null>(null);
  const reported = useRef(new Set<string>());

  useLocalNotifications(runtime, ownUserId, channelNames);

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

  const channel = channels.find((entry) => entry.id === activeChannelId);
  const sessionState = useChannelSession(runtime, activeChannelId, ownUserId);

  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    map.set(ownUserId, ownDisplayName);
    for (const row of presence) {
      if (!map.has(row.userId)) {
        map.set(row.userId, row.userId);
      }
    }
    return map;
  }, [presence, ownUserId, ownDisplayName]);

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
    return map;
  }, [runtime, sessionState.messages]);

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

  const pendingIds = useMemo(
    () => new Set(pendingItems.map((item) => `pending:${item.id}`)),
    [pendingItems],
  );

  const openChannel = useCallback(
    async (channelId: string) => {
      setActiveChannelId(channelId);
      setThreadRoot(null);
      setDrawerOpen(false);
      const summary = channels.find((entry) => entry.id === channelId);
      if (runtime !== undefined && summary !== undefined) {
        try {
          await runtime.session.openChannel(summary);
        } catch {
          // The channel group is not open yet (native engine pending); the
          // banner already explains why.
        }
        if (summary.nameCiphertext !== null && summary.nameCiphertext.length > 0) {
          reportChannelNames([{ id: summary.id, ciphertext: summary.nameCiphertext }]);
        }
      }
    },
    [runtime, channels, reportChannelNames],
  );

  const typing = typingLabel(
    sessionState.typers,
    ownUserId,
    (userId) => memberNames.get(userId) ?? userId,
  );

  return (
    <View className="flex-1 bg-bg">
      <View className="flex-row items-center justify-between border-b border-border px-3 py-3">
        <View className="flex-row items-center gap-3">
          <Pressable accessibilityLabel="Open channels" onPress={() => setDrawerOpen(true)}>
            <Text size="lg">☰</Text>
          </Pressable>
          <Heading level={3}>{channel?.name ?? workspaceName}</Heading>
        </View>
        <View className="flex-row items-center gap-2">
          <Pressable accessibilityLabel="Members" onPress={() => setMembersOpen(true)}>
            <Text size="sm" tone="muted">
              {presence.length} online
            </Text>
          </Pressable>
          <Button size="sm" variant="ghost" onPress={onSignOut}>
            Sign out
          </Button>
        </View>
      </View>

      {mlsError !== null && (
        <View className="border-b border-border bg-accent-soft px-3 py-2">
          <Text size="xs" tone="accent">
            End-to-end encryption is not active on this build: the native crypto module
            (react-native-quick-crypto) is unavailable. Channels and presence are live, but messages
            stay unreadable. Use an Expo dev build, not Expo Go.
          </Text>
        </View>
      )}

      {!ready ? (
        <View className="flex-1 items-center justify-center gap-3">
          <Spinner size={28} label="Opening encrypted channels" />
          <Text size="sm" tone="muted">
            Opening encrypted channels…
          </Text>
        </View>
      ) : channel === undefined ? (
        <View className="flex-1 items-center justify-center">
          <Text tone="muted">Select a channel to start.</Text>
        </View>
      ) : (
        <>
          <View className="items-center border-b border-border px-3 py-1">
            <Text size="xs" tone="secondary" mono>
              E2EE · epoch{" "}
              {sessionState.messages.length > 0
                ? (sessionState.messages[sessionState.messages.length - 1]?.epoch ?? 0)
                : 0}
            </Text>
          </View>
          <MessageList
            runtime={runtime}
            channelId={channel.id}
            messages={mergedMessages}
            decrypted={mergedDecrypted}
            attachments={attachmentsByMessage}
            pendingIds={pendingIds}
            ownUserId={ownUserId}
            memberNames={memberNames}
            memberColors={new Map()}
            firstUnreadId={sessionState.unread.firstUnreadId}
            onReply={(message) => setThreadRoot(message)}
            onJumpToFirstUnread={() => {
              if (sessionState.unread.firstUnreadId !== null) {
                void runtime?.session.markRead(channel.id, sessionState.unread.firstUnreadId);
              }
            }}
          />
          {typing !== null && (
            <View className="px-3 pb-1">
              <Text size="xs" tone="muted">
                {typing}
              </Text>
            </View>
          )}
          <Composer
            channelId={channel.id}
            disabled={mlsError !== null}
            onTyping={(channelId) => {
              void runtime?.port.setTyping({ channelId });
            }}
            onSend={async ({ text, files }) => {
              if (runtime === undefined) {
                return;
              }
              let attachments: readonly AttachmentDescriptor[] | undefined;
              if (files.length > 0) {
                attachments = await uploadPickedFiles(runtime.port, files);
              }
              const result = await sendMessage(channel.id, text, {
                ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
              });
              if (!result.queued && result.messageId !== undefined) {
                void runtime.session.markRead(channel.id, result.messageId);
              }
            }}
          />
        </>
      )}

      <Modal
        visible={drawerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDrawerOpen(false)}
      >
        <Pressable className="flex-1 flex-row bg-black/50" onPress={() => setDrawerOpen(false)}>
          <View className="h-full w-72 bg-surface-1 p-4">
            <Heading level={3}>{workspaceName}</Heading>
            <ScrollView contentContainerStyle={{ gap: 6, paddingVertical: 12 }}>
              {channels.map((entry) => {
                const active = entry.id === activeChannelId;
                return (
                  <Pressable
                    key={entry.id}
                    accessibilityRole="button"
                    onPress={() => void openChannel(entry.id)}
                    className={
                      active ? "rounded-input bg-surface-3 px-3 py-2" : "rounded-input px-3 py-2"
                    }
                  >
                    <Text size="sm" tone={active ? "default" : "muted"}>
                      {entry.kind === "dm" || entry.kind === "group_dm" ? "@ " : "# "}
                      {entry.name}
                    </Text>
                  </Pressable>
                );
              })}
              {channels.length === 0 && (
                <Text size="sm" tone="muted">
                  No channels yet.
                </Text>
              )}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {threadRoot !== null && channel !== undefined && runtime !== undefined && (
        <ThreadModal
          runtime={runtime}
          channelId={channel.id}
          root={threadRoot}
          rootText={sessionState.decrypted.get(threadRoot.id)}
          ownUserId={ownUserId}
          memberNames={memberNames}
          onClose={() => setThreadRoot(null)}
          onSendReply={async ({ text, files, replyInThread }) => {
            let attachments: readonly AttachmentDescriptor[] | undefined;
            if (files.length > 0) {
              attachments = await uploadPickedFiles(runtime.port, files);
            }
            if (replyInThread) {
              await sendMessage(channel.id, text, {
                threadRootId: threadRoot.id,
                ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
              });
            } else {
              await sendMessage(channel.id, text, {
                ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
              });
            }
          }}
        />
      )}

      <MembersSheet
        visible={membersOpen}
        presence={presence}
        memberNames={memberNames}
        onClose={() => setMembersOpen(false)}
        onSetStatus={(status) => {
          void runtime?.port.setStatus({ status });
        }}
      />
    </View>
  );
}
