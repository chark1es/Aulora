import { NativeAvatar } from "@aulora/avatars/native";
import {
  type AttachmentDescriptor,
  type ChannelView,
  conversationTitle,
  expandBroadcast,
  joinedElsewhere,
  type MessagePayload,
  Permission,
  resolveChannelMentions,
  resolveMentions,
} from "@aulora/core";
import { Heading, Icon, IconButton, Spinner, Text, usePalette } from "@aulora/ui-native";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { pickFromLibrary, uploadPickedFiles } from "../../lib/attachments";
import {
  banMember,
  createCategory,
  getUserNote,
  kickMember,
  setUserNote,
  timeoutMember,
} from "../../lib/backend-actions";
import { useIncomingCallNotification, useLocalNotifications } from "../../lib/notifications";
import { planChannelEdit } from "../../lib/permissions";
import { typingLabel } from "../../lib/presence";
import { useChannelSession } from "../../lib/use-channel";
import { usePushRegistration } from "../../lib/use-push-registration";
import { useChat } from "../../providers/ChatProvider";
import { useProfiles } from "../../providers/ProfileProvider";
import { useSound } from "../../providers/SoundProvider";
import { useVoice } from "../../providers/VoiceProvider";
import { CallScreen } from "../voice/CallScreen";
import { IncomingCallModal } from "../voice/IncomingCallModal";
import { JoinedElsewhereScreen } from "../voice/JoinedElsewhereScreen";
import { VoiceChannelSection } from "../voice/VoiceChannelSection";
import { BannedMembersSheet } from "./BannedMembersSheet";
import { Composer } from "./Composer";
import { CreateChannelSheet, type NewChannelKind } from "./CreateChannelSheet";
import { EditChannelSheet } from "./EditChannelSheet";
import { MemberActionsSheet } from "./MemberActionsSheet";
import { MembersSheet } from "./MembersSheet";
import { MessageList } from "./MessageList";
import { SettingsSheet } from "./SettingsSheet";
import { ThreadModal } from "./ThreadModal";
import { type ThreadInboxItem, ThreadsInbox } from "./ThreadsInbox";
import { UserNoteSheet } from "./UserNoteSheet";
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
  const {
    runtime,
    ready,
    channels,
    categories,
    presence,
    outbox,
    members,
    roles,
    canManageChannels,
    canKick,
    canBan,
    canTimeout,
    canModerateMembers,
    canMentionEveryone,
    ownerUserId,
    sendMessage,
    avatarUrls,
  } = useChat();
  const generateAvatarUploadUrl = useMutation(api.members.generateAvatarUploadUrl);
  const setAvatar = useMutation(api.members.setAvatar);
  const { activeProfile } = useProfiles();
  const voice = useVoice();
  const sound = useSound();
  const pushState = usePushRegistration(runtime?.client, Platform.OS === "ios" ? "ios" : "android");
  const [activeChannelId, setActiveChannelId] = useState<string | undefined>(undefined);
  const [mainView, setMainView] = useState<"channels" | "threads">("channels");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [bansOpen, setBansOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [threadRoot, setThreadRoot] = useState<MessagePayload | null>(null);
  const [channelAction, setChannelAction] = useState<ChannelView | null>(null);
  const [editChannelModal, setEditChannelModal] = useState<ChannelView | null>(null);
  const [editChannelBusy, setEditChannelBusy] = useState(false);
  const [editChannelError, setEditChannelError] = useState<string | null>(null);
  const [memberActionsFor, setMemberActionsFor] = useState<string | null>(null);
  const [moderationBusy, setModerationBusy] = useState(false);
  const [moderationError, setModerationError] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);

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

  const mentionChannelTargets = useMemo(
    () =>
      channels
        .filter((entry) => entry.kind === "text" || entry.kind === "announcement")
        .map((entry) => ({ channelId: entry.id, name: entry.name })),
    [channels],
  );

  const mentionChannelOptions = useMemo(
    () => mentionChannelTargets.map((target) => ({ id: target.channelId, name: target.name })),
    [mentionChannelTargets],
  );

  const mentionCategoryTargets = useMemo(
    () => categories.map((category) => ({ categoryId: category.id, name: category.name })),
    [categories],
  );

  // Names `#` autocomplete and the message renderer should recognise: real
  // channels resolve to a destination, categories are highlighted only.
  const mentionNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const target of mentionChannelTargets) {
      map.set(target.channelId, target.name);
    }
    for (const target of mentionCategoryTargets) {
      map.set(`category:${target.categoryId}`, target.name);
    }
    return map;
  }, [mentionChannelTargets, mentionCategoryTargets]);

  const mentionUserTargets = useMemo(
    () => members.map((member) => ({ userId: member.userId, displayName: member.displayName })),
    [members],
  );
  const mentionMemberIds = useMemo(() => members.map((member) => member.userId), [members]);

  const visibleChannels = useMemo(() => {
    if (showHidden) {
      return channels;
    }
    return channels.filter((entry) => entry.hidden !== true || entry.id === activeChannelId);
  }, [channels, showHidden, activeChannelId]);

  const hiddenCount = useMemo(
    () => channels.filter((entry) => entry.hidden === true).length,
    [channels],
  );

  const mutedChannelIds = useMemo(
    () => new Set(channels.filter((entry) => entry.muted === true).map((entry) => entry.id)),
    [channels],
  );

  useLocalNotifications(runtime, ownUserId, channelNames, {
    mutedChannelIds,
    onCue: (event) => sound?.play(event),
  });

  useEffect(() => {
    if (activeChannelId === undefined) {
      const firstText = channels.find((entry) => entry.kind !== "voice" && entry.hidden !== true);
      if (firstText !== undefined) {
        setActiveChannelId(firstText.id);
      }
    }
  }, [channels, activeChannelId]);

  const channel = channels.find((entry) => entry.id === activeChannelId);
  const sessionState = useChannelSession(runtime, activeChannelId, ownUserId);

  // Call cues: connect on the first participant, then join/leave as the roster
  // changes, mirroring web.
  const callParticipantCount = voice.call?.participants.length ?? 0;
  const connectedRef = useRef(false);
  const participantCountRef = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fire on roster changes only
  useEffect(() => {
    if (callParticipantCount === 0) {
      connectedRef.current = false;
      participantCountRef.current = 0;
      return;
    }
    if (!connectedRef.current) {
      connectedRef.current = true;
      participantCountRef.current = callParticipantCount;
      sound?.play("call-connect");
      return;
    }
    const previous = participantCountRef.current;
    participantCountRef.current = callParticipantCount;
    if (callParticipantCount > previous) {
      sound?.play("call-join");
    } else if (callParticipantCount < previous) {
      sound?.play("call-leave");
    }
  }, [callParticipantCount]);

  const incomingCount = voice.incoming.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: fire on arrival only
  useEffect(() => {
    if (incomingCount > 0) {
      sound?.play("call-ring");
    }
  }, [incomingCount]);

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

  useIncomingCallNotification(
    voice.incoming,
    (call) => memberNames.get(call.initiatorId) ?? call.initiatorId,
  );

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

  const ownPresence = presence.find((row) => row.userId === ownUserId);
  const ownStatus = ownPresence?.status ?? "offline";
  const ownCustomStatus = ownPresence?.customStatus ?? "";

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

  const joinVoiceChannel = useCallback(
    (channelId: string) => {
      setDrawerOpen(false);
      void openChannel(channelId);
      const live = voice.activeCalls.find((entry) => entry.channelId === channelId);
      if (live !== undefined) {
        void voice.joinCall(live.id);
      } else {
        void voice.startCall(channelId, "voice");
      }
    },
    [openChannel, voice],
  );

  const create = useCallback(
    async (input: {
      readonly kind: NewChannelKind;
      readonly name: string;
      readonly topic?: string;
      readonly categoryId?: string;
      readonly private: boolean;
    }) => {
      if (runtime === undefined) {
        return;
      }
      setCreateBusy(true);
      setCreateError(null);
      try {
        const newId = await runtime.port.createChannel({
          kind: input.kind,
          name: input.name,
          ...(input.topic !== undefined ? { topic: input.topic } : {}),
          ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
          private: input.private,
        });
        setCreateOpen(false);
        if (input.kind !== "voice") {
          await openChannel(newId);
        }
      } catch (error) {
        setCreateError(errorMessage(error));
      } finally {
        setCreateBusy(false);
      }
    },
    [runtime, openChannel],
  );

  const createNewCategory = useCallback(
    async (name: string) => {
      if (runtime === undefined) {
        return;
      }
      setCreateBusy(true);
      setCreateError(null);
      try {
        await createCategory(runtime.client, name);
        setCreateOpen(false);
      } catch (error) {
        setCreateError(errorMessage(error));
      } finally {
        setCreateBusy(false);
      }
    },
    [runtime],
  );

  const toggleMute = useCallback(
    async (target: ChannelView) => {
      if (runtime === undefined) {
        return;
      }
      await runtime.port.setChannelMuted?.({
        channelId: target.id,
        muted: target.muted !== true,
      });
      setChannelAction(null);
    },
    [runtime],
  );

  const toggleHide = useCallback(
    async (target: ChannelView) => {
      if (runtime === undefined) {
        return;
      }
      await runtime.port.setChannelHidden?.({
        channelId: target.id,
        hidden: target.hidden !== true,
      });
      setChannelAction(null);
    },
    [runtime],
  );

  const markChannelRead = useCallback(async () => {
    if (runtime === undefined || activeChannelId === undefined) {
      return;
    }
    const latest = sessionState.messages[sessionState.messages.length - 1];
    if (latest !== undefined) {
      await runtime.session.markRead(activeChannelId, latest.id);
    }
    setChannelAction(null);
  }, [runtime, activeChannelId, sessionState.messages]);

  const runModeration = useCallback(
    async (task: (client: NonNullable<typeof runtime>["client"]) => Promise<void>) => {
      if (runtime === undefined) {
        return;
      }
      setModerationBusy(true);
      setModerationError(null);
      try {
        await task(runtime.client);
        setMemberActionsFor(null);
      } catch (error) {
        setModerationError(errorMessage(error));
      } finally {
        setModerationBusy(false);
      }
    },
    [runtime],
  );

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

  const confirmSignOut = useCallback(() => {
    Alert.alert(`Sign out of ${workspaceName}?`, "You can sign back in at any time.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: onSignOut },
    ]);
  }, [workspaceName, onSignOut]);

  return (
    <View className="flex-1 bg-bg">
      <View className="flex-row items-center justify-between border-b border-border px-3 py-3">
        <View className="flex-row items-center gap-3">
          <Pressable accessibilityLabel="Open channels" onPress={() => setDrawerOpen(true)}>
            <Icon name="menu" size={20} color={palette.text} />
          </Pressable>
          <Heading level={3}>
            {mainView === "threads" ? "Threads" : (channel?.name ?? workspaceName)}
          </Heading>
        </View>
        <View className="flex-row items-center gap-2">
          {mainView === "channels" &&
            channel !== undefined &&
            (channel.kind === "dm" || channel.kind === "group_dm") &&
            voice.canConnect && (
              <>
                <IconButton
                  label="Start voice call"
                  variant="ghost"
                  size="sm"
                  onPress={() => void voice.startCall(channel.id, "voice")}
                >
                  <Icon name="phone" size={18} color={palette.text} />
                </IconButton>
                {voice.canVideo && (
                  <IconButton
                    label="Start video call"
                    variant="ghost"
                    size="sm"
                    onPress={() => void voice.startCall(channel.id, "video")}
                  >
                    <Icon name="video" size={18} color={palette.text} />
                  </IconButton>
                )}
              </>
            )}
          <Pressable accessibilityLabel="Members" onPress={() => setMembersOpen(true)}>
            <Text size="sm" tone="muted">
              {presence.length} online
            </Text>
          </Pressable>
          <IconButton
            label="Settings"
            variant="ghost"
            size="sm"
            onPress={() => setSettingsOpen(true)}
          >
            <Icon name="settings" size={18} color={palette.text} />
          </IconButton>
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
      ) : channel.kind === "voice" &&
        joinedElsewhere(
          voice.activeCalls.find((entry) => entry.channelId === channel.id) ?? null,
          ownUserId,
          voice.clientId,
          voice.callId,
        ) ? (
        <JoinedElsewhereScreen
          channelName={channel.name}
          pending={voice.pending}
          canJoin={voice.canConnect}
          onJoin={() => joinVoiceChannel(channel.id)}
        />
      ) : (
        <>
          <View className="items-center border-b border-border px-3 py-1">
            <Text size="xs" tone="secondary" mono>
              Server-side encryption
            </Text>
          </View>
          <MessageList
            key={channel.id}
            runtime={runtime}
            channelId={channel.id}
            messages={mergedMessages}
            decrypted={mergedDecrypted}
            attachments={attachmentsByMessage}
            pendingIds={pendingIds}
            ownUserId={ownUserId}
            memberNames={memberNames}
            memberColors={memberColors}
            channelNames={mentionNames}
            firstUnreadId={sessionState.unread.firstUnreadId}
            onReply={(message) => setThreadRoot(message)}
            onChannelPress={(name) => {
              const target = mentionChannelTargets.find((entry) => entry.name === name);
              if (target !== undefined) {
                void openChannel(target.channelId);
              }
            }}
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
            members={mentionUserTargets}
            roles={roles}
            channels={mentionChannelOptions}
            canMentionEveryone={canMentionEveryone}
            viewerName={ownDisplayName}
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
              const resolution = resolveMentions(text, mentionUserTargets, roles);
              const mentionUserIds = expandBroadcast(resolution, mentionMemberIds);
              const channelMentions = resolveChannelMentions(
                text,
                mentionChannelTargets,
                mentionCategoryTargets,
              );
              const result = await sendMessage(channel.id, text, {
                ...(mentionUserIds.length > 0 ? { mentionUserIds } : {}),
                ...(channelMentions.channelIds.length > 0
                  ? { mentionChannelIds: channelMentions.channelIds }
                  : {}),
                ...(channelMentions.categoryIds.length > 0
                  ? { mentionCategoryIds: channelMentions.categoryIds }
                  : {}),
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
              <Icon name="chevron-down" size={16} color={palette["text-muted"]} />
            </Pressable>
            <View className="mt-2 flex-row items-center gap-2">
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
                    ? "flex-1 flex-row items-center gap-2 rounded-input bg-surface-3 px-3 py-2"
                    : "flex-1 flex-row items-center gap-2 rounded-input px-3 py-2"
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
              {canManageChannels && (
                <IconButton
                  label="Create channel"
                  variant="secondary"
                  size="sm"
                  onPress={() => {
                    setCreateError(null);
                    setCreateOpen(true);
                  }}
                >
                  <Icon name="plus" size={18} color={palette.text} />
                </IconButton>
              )}
            </View>
            <ScrollView contentContainerStyle={{ gap: 6, paddingVertical: 12 }}>
              {visibleChannels
                .filter((entry) => entry.kind !== "voice")
                .map((entry) => {
                  const active = entry.id === activeChannelId;
                  return (
                    <Pressable
                      key={entry.id}
                      accessibilityRole="button"
                      onPress={() => void openChannel(entry.id)}
                      onLongPress={() => setChannelAction(entry)}
                      delayLongPress={300}
                      className={
                        active ? "rounded-input bg-surface-3 px-3 py-2" : "rounded-input px-3 py-2"
                      }
                    >
                      <View className="flex-row items-center gap-2">
                        <Text size="sm" tone={active ? "default" : "muted"} className="flex-1">
                          {entry.kind === "dm" || entry.kind === "group_dm" ? "@ " : "# "}
                          {entry.name}
                        </Text>
                        {entry.muted === true && (
                          <Icon name="bell-off" size={13} color={palette["text-muted"]} />
                        )}
                        {entry.hidden === true && (
                          <Icon name="eye-off" size={13} color={palette["text-muted"]} />
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              {visibleChannels.length === 0 && (
                <Text size="sm" tone="muted">
                  No channels yet.
                </Text>
              )}
              {hiddenCount > 0 && (
                <Pressable
                  accessibilityRole="button"
                  className="rounded-input px-3 py-2"
                  onPress={() => setShowHidden(!showHidden)}
                >
                  <Text size="xs" tone="muted">
                    {showHidden ? "Hide hidden channels" : `Show ${hiddenCount} hidden`}
                  </Text>
                </Pressable>
              )}
              <VoiceChannelSection
                channels={visibleChannels}
                activeCalls={voice.activeCalls}
                memberNames={memberNames}
                selfUserId={ownUserId}
                clientId={voice.clientId}
                localCallId={voice.callId}
                remoteLevels={voice.remoteLevels}
                onJoin={joinVoiceChannel}
              />
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
            <Heading level={3} className="px-3 pb-1">
              {channelAction?.name}
            </Heading>
            {channelAction !== null && (
              <>
                <Pressable
                  accessibilityRole="button"
                  className="rounded-input px-3 py-3"
                  onPress={() => void toggleMute(channelAction)}
                >
                  <Text>{channelAction.muted === true ? "Unmute channel" : "Mute channel"}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  className="rounded-input px-3 py-3"
                  onPress={() => void toggleHide(channelAction)}
                >
                  <Text>{channelAction.hidden === true ? "Show channel" : "Hide channel"}</Text>
                </Pressable>
                {channelAction.id === activeChannelId && (
                  <Pressable
                    accessibilityRole="button"
                    className="rounded-input px-3 py-3"
                    onPress={() => void markChannelRead()}
                  >
                    <Text>Mark as read</Text>
                  </Pressable>
                )}
                {canManageChannels &&
                  (channelAction.kind === "text" || channelAction.kind === "announcement") && (
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
              </>
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
          roles={roles}
          channels={mentionChannelOptions}
          channelNames={mentionNames}
          onChannelPress={(name) => {
            const target = mentionChannelTargets.find((entry) => entry.name === name);
            if (target !== undefined) {
              setThreadRoot(null);
              void openChannel(target.channelId);
            }
          }}
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
        ownerUserId={ownerUserId}
        canModerateMembers={canModerateMembers}
        onClose={() => setMembersOpen(false)}
        onOpenSettings={() => {
          setMembersOpen(false);
          setSettingsOpen(true);
        }}
        {...(canBan
          ? {
              onOpenBans: () => {
                setMembersOpen(false);
                setBansOpen(true);
              },
            }
          : {})}
        onMemberActions={(userId) => {
          setModerationError(null);
          setMemberActionsFor(userId);
        }}
        onSetStatus={(status, customStatus) => {
          void runtime?.port.setStatus({
            status,
            ...(customStatus !== undefined ? { customStatus } : {}),
          });
        }}
      />

      <SettingsSheet
        visible={settingsOpen}
        ownUserId={ownUserId}
        ownDisplayName={ownDisplayName}
        hasAvatar={avatarUrls.has(ownUserId)}
        onChangeAvatar={() => {
          void (async () => {
            const [file] = await pickFromLibrary();
            if (file === undefined) {
              return;
            }
            const bytes = await fetch(file.uri).then((response) => response.blob());
            if (bytes.size > 4 * 1024 * 1024) {
              Alert.alert("Image too large", "Choose an image under 4 MB.");
              return;
            }
            const uploadUrl = await generateAvatarUploadUrl({});
            const uploaded = await fetch(uploadUrl, {
              method: "POST",
              headers: { "Content-Type": file.mime },
              body: bytes,
            });
            if (!uploaded.ok) {
              Alert.alert("Couldn't update your profile picture.");
              return;
            }
            const body = (await uploaded.json()) as { storageId?: unknown };
            if (typeof body.storageId !== "string") {
              Alert.alert("Couldn't update your profile picture.");
              return;
            }
            await setAvatar({ storageId: body.storageId as never });
          })().catch(() => Alert.alert("Couldn't update your profile picture."));
        }}
        onClearAvatar={() => {
          void setAvatar({}).catch(() => Alert.alert("Couldn't remove your profile picture."));
        }}
        ownStatus={ownStatus}
        ownCustomStatus={ownCustomStatus}
        pushState={pushState}
        onSetStatus={(status, customStatus) => {
          void runtime?.port.setStatus({
            status,
            ...(customStatus !== undefined ? { customStatus } : {}),
          });
        }}
        onSignOut={() => {
          setSettingsOpen(false);
          confirmSignOut();
        }}
        onClose={() => setSettingsOpen(false)}
      />

      {canBan && (
        <BannedMembersSheet
          visible={bansOpen}
          memberNames={memberNames}
          onClose={() => setBansOpen(false)}
        />
      )}

      <CreateChannelSheet
        visible={createOpen}
        categories={categories}
        busy={createBusy}
        error={createError}
        onCreateChannel={create}
        onCreateCategory={createNewCategory}
        onClose={() => setCreateOpen(false)}
      />

      <MemberActionsSheet
        visible={memberActionsFor !== null}
        memberName={
          memberActionsFor === null ? "" : (memberNames.get(memberActionsFor) ?? memberActionsFor)
        }
        canKick={canKick}
        canBan={canBan}
        canTimeout={canTimeout}
        busy={moderationBusy}
        error={moderationError}
        onKick={() => {
          const target = memberActionsFor;
          if (target !== null) {
            void runModeration((client) => kickMember(client, target));
          }
        }}
        onBan={(options) => {
          const target = memberActionsFor;
          if (target !== null) {
            void runModeration((client) => banMember(client, target, options));
          }
        }}
        onTimeout={(durationMs) => {
          const target = memberActionsFor;
          if (target !== null) {
            void runModeration((client) =>
              timeoutMember(
                client,
                target,
                durationMs === undefined ? undefined : Date.now() + durationMs,
              ),
            );
          }
        }}
        onOpenNote={() => {
          const target = memberActionsFor;
          if (target !== null) {
            setNoteFor(target);
          }
        }}
        onClose={() => {
          setMemberActionsFor(null);
          setModerationError(null);
        }}
      />

      {noteFor !== null && runtime !== undefined && (
        <UserNoteSheet
          visible
          memberName={memberNames.get(noteFor) ?? noteFor}
          loadNote={() => getUserNote(runtime.client, noteFor)}
          onSave={(body) => setUserNote(runtime.client, noteFor, body)}
          onClose={() => setNoteFor(null)}
        />
      )}

      <IncomingCallModal
        callerName={(call) => memberNames.get(call.initiatorId) ?? call.initiatorId}
      />

      <CallScreen
        channelName={channel?.name ?? workspaceName}
        memberNames={memberNames}
        memberColors={memberColors}
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
