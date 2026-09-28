import { NativeAvatar } from "@aulora/avatars/native";
import {
  type AttachmentDescriptor,
  type ChannelView,
  conversationTitle,
  type MessagePayload,
  Permission,
} from "@aulora/core";
import { Button, Heading, Spinner, Text, usePalette } from "@aulora/ui-native";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { uploadPickedFiles } from "../../lib/attachments";
import { useLocalNotifications } from "../../lib/notifications";
import { planChannelEdit } from "../../lib/permissions";
import { typingLabel } from "../../lib/presence";
import { useChannelSession } from "../../lib/use-channel";
import { useChat } from "../../providers/ChatProvider";
import { useProfiles } from "../../providers/ProfileProvider";
import { Composer } from "./Composer";
import { EditChannelSheet } from "./EditChannelSheet";
import { MembersSheet } from "./MembersSheet";
import { MessageList } from "./MessageList";
import { ThreadModal } from "./ThreadModal";
import { type ThreadInboxItem, ThreadsInbox } from "./ThreadsInbox";
import { WorkspaceSwitcherSheet } from "./WorkspaceSwitcherSheet";

export interface ChatScreenProps {
  readonly workspaceName: string;
  readonly ownUserId: string;
  readonly ownDisplayName: string;
  readonly onSignOut: () => void;
}

/**
 * The signed-in mobile chat surface: channel drawer, plaintext message list,
 * composer, threads, reactions, presence and typing.
 */
export function ChatScreen({
  workspaceName,
  ownUserId,
  ownDisplayName,
  onSignOut,
}: ChatScreenProps) {
  const palette = usePalette();
  const { runtime, ready, channels, presence, outbox, members, canManageChannels, sendMessage } =
    useChat();
  const { activeProfile } = useProfiles();
  const [activeChannelId, setActiveChannelId] = useState<string | undefined>(undefined);
  const [mainView, setMainView] = useState<"channels" | "threads">("channels");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [threadRoot, setThreadRoot] = useState<MessagePayload | null>(null);
  const [channelAction, setChannelAction] = useState<ChannelView | null>(null);
  const [editChannelModal, setEditChannelModal] = useState<ChannelView | null>(null);
  const [editChannelBusy, setEditChannelBusy] = useState(false);
  const [editChannelError, setEditChannelError] = useState<string | null>(null);

  // Subscribe only while the drawer badge or Threads view needs it; the query
  // fetches on open.
  const threadRows = useQuery(
    api.messages.threadInbox,
    drawerOpen || mainView === "threads" ? {} : "skip",
  );
  const threadMentionCount = useMemo(
    () => (threadRows ?? []).filter((row) => row.viewerMentioned).length,
    [threadRows],
  );

  const channelNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of channels) {
      map.set(entry.id, entry.name);
    }
    return map;
  }, [channels]);

  // Only text/announcement channels carry a `#name`; DMs are titled by member.
  const textChannelNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of channels) {
      if (entry.kind === "text" || entry.kind === "announcement") {
        map.set(entry.id, entry.name);
      }
    }
    return map;
  }, [channels]);

  useLocalNotifications(runtime, ownUserId, channelNames);

  useEffect(() => {
    if (activeChannelId === undefined && channels.length > 0) {
      setActiveChannelId(channels[0]?.id);
    }
  }, [channels, activeChannelId]);

  const channel = channels.find((entry) => entry.id === activeChannelId);
  const sessionState = useChannelSession(runtime, activeChannelId, ownUserId);

  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    map.set(ownUserId, ownDisplayName);
    for (const member of members) {
      map.set(member.userId, member.displayName);
    }
    for (const row of presence) {
      if (!map.has(row.userId)) {
        map.set(row.userId, row.userId);
      }
    }
    return map;
  }, [members, presence, ownUserId, ownDisplayName]);

  const memberColors = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      if (member.roleColor !== null) {
        map.set(member.userId, member.roleColor);
      }
    }
    return map;
  }, [members]);

  const titles = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of channels) {
      map.set(
        entry.id,
        conversationTitle(entry, ownUserId, (userId) => memberNames.get(userId)),
      );
    }
    return map;
  }, [channels, ownUserId, memberNames]);

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
        body: item.text,
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
      setMainView("channels");
      setDrawerOpen(false);
      const summary = channels.find((entry) => entry.id === channelId);
      if (runtime !== undefined && summary !== undefined) {
        await runtime.session.openChannel(summary);
      }
    },
    [runtime, channels],
  );

  // A Threads-inbox row opens the existing thread sheet for its root message.
  const openThreadFromInbox = useCallback(
    (thread: ThreadInboxItem) => {
      const root: MessagePayload = {
        id: thread.id,
        channelId: thread.channelId,
        authorId: thread.authorId,
        body: thread.body,
        threadRootId: null,
        attachmentIds: [],
        mentionUserIds: [...thread.mentionedUserIds],
        editedAt: null,
        deletedAt: null,
        pinnedAt: null,
        replyCount: thread.replyCount,
        lastReplyAt: thread.lastReplyAt,
        createdAt: thread.createdAt,
      };
      setActiveChannelId(thread.channelId);
      setThreadRoot(root);
      setMainView("channels");
      setDrawerOpen(false);
      const summary = channels.find((entry) => entry.id === thread.channelId);
      if (runtime !== undefined && summary !== undefined) {
        void runtime.session.openChannel(summary);
      }
    },
    [channels, runtime],
  );

  const submitChannelEdit = useCallback(
    async (patch: {
      readonly name: string;
      readonly topic: string;
      readonly private: boolean;
      readonly memberIds: readonly string[];
      readonly blockedUserIds: readonly string[];
    }) => {
      const target = editChannelModal;
      if (target === null || runtime === undefined) {
        return;
      }
      const original = {
        name: titles.get(target.id) ?? target.name,
        topic: target.topic ?? "",
        private: target.isPrivate === true,
        memberIds: target.memberIds ?? [],
        blockedUserIds: (target.overrides ?? [])
          .filter((override) => override.targetType === "member")
          .filter((override) => (override.deny & Permission.ViewChannel) !== 0n)
          .map((override) => override.targetId),
      };
      const plan = planChannelEdit(original, patch, ownUserId);
      setEditChannelBusy(true);
      setEditChannelError(null);
      try {
        if (plan.name !== null) {
          await runtime.session.setChannelName(target.id, plan.name);
        }
        if (plan.topic !== null) {
          await runtime.port.setChannelTopic({ channelId: target.id, topic: plan.topic });
        }
        if (plan.privacy !== null) {
          await runtime.port.setChannelPrivate({
            channelId: target.id,
            private: plan.privacy.private,
            memberIds: plan.privacy.memberIds,
          });
        }
        if (plan.blockedUserIds !== null) {
          await runtime.port.setChannelBlocked({
            channelId: target.id,
            userIds: plan.blockedUserIds,
          });
        }
        setEditChannelModal(null);
      } catch (error) {
        setEditChannelError(errorMessage(error));
      } finally {
        setEditChannelBusy(false);
      }
    },
    [editChannelModal, ownUserId, runtime, titles],
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
          <Heading level={3}>
            {mainView === "threads" ? "Threads" : (channel?.name ?? workspaceName)}
          </Heading>
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

      {!ready ? (
        <View className="flex-1 items-center justify-center gap-3">
          <Spinner size={28} label="Opening channels" />
          <Text size="sm" tone="muted">
            Opening channels…
          </Text>
        </View>
      ) : mainView === "threads" ? (
        <ThreadsInbox
          threads={threadRows ?? []}
          loading={threadRows === undefined}
          channelNames={textChannelNames}
          memberNames={memberNames}
          memberColors={memberColors}
          titles={titles}
          ownUserId={ownUserId}
          onOpen={openThreadFromInbox}
        />
      ) : channel === undefined ? (
        <View className="flex-1 items-center justify-center">
          <Text tone="muted">Select a channel to start.</Text>
        </View>
      ) : (
        <>
          <View className="items-center border-b border-border px-3 py-1">
            <Text size="xs" tone="secondary" mono>
              Server-side encryption
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
            memberColors={memberColors}
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Switch workspace, current ${workspaceName}`}
              onPress={() => {
                setDrawerOpen(false);
                setWorkspaceSwitcherOpen(true);
              }}
              className="flex-row items-center gap-3 rounded-input px-1 py-1"
            >
              <NativeAvatar
                seed={activeProfile?.iconSeed ?? workspaceName}
                size={28}
                title={workspaceName}
              />
              <Heading level={3} className="flex-1" numberOfLines={1}>
                {workspaceName}
              </Heading>
              <Text size="sm" tone="muted">
                ⌄
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: mainView === "threads" }}
              onPress={() => {
                setMainView("threads");
                setThreadRoot(null);
                setDrawerOpen(false);
              }}
              className={
                mainView === "threads"
                  ? "mt-2 flex-row items-center gap-2 rounded-input bg-surface-3 px-3 py-2"
                  : "mt-2 flex-row items-center gap-2 rounded-input px-3 py-2"
              }
            >
              <Text size="sm" tone={mainView === "threads" ? "default" : "muted"}>
                # Threads
              </Text>
              {threadMentionCount > 0 && (
                <View className="rounded-pill bg-accent px-1.5 py-0.5">
                  <Text size="xs" className="font-bold" style={{ color: palette["on-accent"] }}>
                    {threadMentionCount > 9 ? "9+" : String(threadMentionCount)}
                  </Text>
                </View>
              )}
            </Pressable>
            <ScrollView contentContainerStyle={{ gap: 6, paddingVertical: 12 }}>
              {channels.map((entry) => {
                const active = entry.id === activeChannelId;
                return (
                  <Pressable
                    key={entry.id}
                    accessibilityRole="button"
                    onPress={() => void openChannel(entry.id)}
                    onLongPress={() => {
                      if (
                        (entry.kind === "text" || entry.kind === "announcement") &&
                        canManageChannels
                      ) {
                        setChannelAction(entry);
                      }
                    }}
                    delayLongPress={300}
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

      <Modal
        visible={channelAction !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setChannelAction(null)}
      >
        <Pressable
          className="flex-1 justify-end bg-black/50"
          onPress={() => setChannelAction(null)}
        >
          <View className="gap-1 rounded-t-card bg-surface-2 p-4">
            <Text size="sm" className="px-3 pb-1 font-medium">
              {channelAction?.name}
            </Text>
            {canManageChannels && (
              <Pressable
                accessibilityRole="button"
                className="rounded-input px-3 py-3"
                onPress={() => {
                  const target = channelAction;
                  if (target === null) {
                    return;
                  }
                  setEditChannelError(null);
                  setEditChannelModal(target);
                  setChannelAction(null);
                  setDrawerOpen(false);
                }}
              >
                <Text>Edit channel…</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              className="rounded-input px-3 py-3"
              onPress={() => setChannelAction(null)}
            >
              <Text tone="muted">Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {editChannelModal !== null && (
        <EditChannelSheet
          visible
          channelName={titles.get(editChannelModal.id) ?? editChannelModal.name}
          channelTopic={editChannelModal.topic ?? ""}
          isPrivate={editChannelModal.isPrivate === true}
          initialMemberIds={
            editChannelModal.isPrivate === true
              ? [...new Set([ownUserId, ...(editChannelModal.memberIds ?? [])])]
              : (editChannelModal.memberIds ?? [])
          }
          initialBlockedUserIds={(editChannelModal.overrides ?? [])
            .filter((override) => override.targetType === "member")
            .filter((override) => (override.deny & Permission.ViewChannel) !== 0n)
            .map((override) => override.targetId)}
          ownUserId={ownUserId}
          members={members}
          busy={editChannelBusy}
          error={editChannelError}
          onClose={() => {
            setEditChannelModal(null);
            setEditChannelError(null);
          }}
          onSave={submitChannelEdit}
        />
      )}

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
        ownUserId={ownUserId}
        onClose={() => setMembersOpen(false)}
        onSetStatus={(status, customStatus) => {
          void runtime?.port.setStatus({
            status,
            ...(customStatus !== undefined ? { customStatus } : {}),
          });
        }}
      />

      <WorkspaceSwitcherSheet
        visible={workspaceSwitcherOpen}
        onClose={() => setWorkspaceSwitcherOpen(false)}
      />
    </View>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "Something went wrong. Please try again.";
}
