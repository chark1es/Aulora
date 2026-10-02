import {
  type AttachmentDescriptor,
  type ChannelView,
  conversationTitle,
  dmPartnerId,
  expandBroadcast,
  hasPermission,
  joinedElsewhere,
  type MessagePayload,
  Permission,
  resolveChannelMentions,
  resolveMentions,
} from "@aulora/core";
import { Button, Icon, Spinner, Text, usePalette } from "@aulora/ui-native";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, BackHandler, Keyboard, Platform, Pressable, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { selectionFeedback } from "../../lib/haptics";
import { useIncomingCallNotification, useLocalNotifications } from "../../lib/notifications";
import { planChannelEdit } from "../../lib/permissions";
import { presenceLabel, typingLabel } from "../../lib/presence";
import { recentSearchKey } from "../../lib/search-ui";
import { useChannelSession } from "../../lib/use-channel";
import { usePushRegistration } from "../../lib/use-push-registration";
import { useChat } from "../../providers/ChatProvider";
import { useProfiles } from "../../providers/ProfileProvider";
import { useSound } from "../../providers/SoundProvider";
import { useVoice } from "../../providers/VoiceProvider";
import { CallScreen } from "../voice/CallScreen";
import { IncomingCallModal } from "../voice/IncomingCallModal";
import { JoinedElsewhereScreen } from "../voice/JoinedElsewhereScreen";
import { BannedMembersSheet } from "./BannedMembersSheet";
import { BottomSheet, useLingering } from "./BottomSheet";
import { ChannelList } from "./ChannelList";
import { Composer } from "./Composer";
import { CreateChannelSheet, type NewChannelKind } from "./CreateChannelSheet";
import { DirectList } from "./DirectList";
import { EditChannelSheet } from "./EditChannelSheet";
import { HubDock, type HubTab, PaneHeader, RoundButton, useDockClearance } from "./HubPane";
import { ListGroup, ListRow } from "./List";
import { MemberActionsSheet } from "./MemberActionsSheet";
import { MemberProfileSheet } from "./MemberProfileSheet";
import { MembersPane } from "./MembersPane";
import { MessageList } from "./MessageList";
import { NewConversationSheet } from "./NewConversationSheet";
import { PinnedMessagesSheet } from "./PinnedMessagesSheet";
import { PresenceAvatar } from "./PresenceAvatar";
import { SearchView } from "./SearchView";
import { SettingsView } from "./SettingsView";
import { type PaneIndex, SwipePanes } from "./SwipePanes";
import { ThreadModal } from "./ThreadModal";
import { type ThreadInboxItem, ThreadsInbox } from "./ThreadsInbox";
import { UserNoteSheet } from "./UserNoteSheet";
import { WorkspaceSwitcherSheet } from "./WorkspaceSwitcherSheet";

export interface ChatScreenProps {
  readonly workspaceName: string;
  readonly ownUserId: string;
  readonly ownDisplayName: string;
  readonly onSignOut: () => void | Promise<void>;
}

/**
 * The signed-in mobile chat surface as three full-screen panes. The conversation
 * sits in the middle; swipe right for the hub (conversations, threads, search,
 * settings) and left for the people in it.
 */
export function ChatScreen({
  workspaceName,
  ownUserId,
  ownDisplayName,
  onSignOut,
}: ChatScreenProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const {
    runtime,
    ready,
    startupError,
    retryStartup,
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
    search,
    loadSearchHistory,
    retrySend,
    discardSend,
    permissionsFor,
    viewerPermissions,
  } = useChat();
  const generateAvatarUploadUrl = useMutation(api.members.generateAvatarUploadUrl);
  const setAvatar = useMutation(api.members.setAvatar);
  const { activeProfile } = useProfiles();
  const voice = useVoice();
  const sound = useSound();
  const { state: pushState, unregister: unregisterPush } = usePushRegistration(
    runtime?.client,
    Platform.OS === "ios" ? "ios" : "android",
  );
  const [activeChannelId, setActiveChannelId] = useState<string | undefined>(undefined);
  const [pane, setPane] = useState<PaneIndex>(1);
  const [hubTab, setHubTab] = useState<HubTab>("chats");
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const [quote, setQuote] = useState<MessagePayload | null>(null);
  const [jumpToMessageId, setJumpToMessageId] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [bansOpen, setBansOpen] = useState(false);
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
  const threadRows = useQuery(api.messages.threadInbox, {});
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
  const channelPermissions = channel === undefined ? viewerPermissions : permissionsFor(channel);
  const sessionState = useChannelSession(
    runtime,
    hasPermission(channelPermissions, Permission.ReadHistory) ? activeChannelId : undefined,
    ownUserId,
  );
  const messageContext = useQuery(
    api.messages.context,
    jumpToMessageId === null ? "skip" : { messageId: jumpToMessageId as never },
  );
  useEffect(() => {
    if (messageContext !== undefined && messageContext !== null)
      void runtime?.session.receiveMessages(messageContext.history);
    if (messageContext?.message.threadRootId != null) setThreadRoot(messageContext.root);
  }, [messageContext, runtime]);

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

  const attachmentsByMessage = (() => {
    const map = new Map<string, readonly AttachmentDescriptor[]>();
    if (runtime !== undefined) {
      for (const message of [...(messageContext?.history ?? []), ...sessionState.messages]) {
        const list = runtime.session.attachmentsFor(message.id);
        if (list.length > 0) {
          map.set(message.id, list);
        }
      }
    }
    return map;
  })();

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
        attachmentIds: (item.attachments ?? []).map((file) => file.fileId),
        replyToId: item.replyToId ?? null,
        mentionUserIds: [...item.mentionUserIds],
        editedAt: null,
        deletedAt: null,
        pinnedAt: null,
        createdAt: item.createdAt,
      })),
    [pendingItems, ownUserId],
  );

  const mergedMessages = useMemo(() => {
    const all = new Map(
      (messageContext?.history ?? []).map((message) => [
        message.id as string,
        message as MessagePayload,
      ]),
    );
    for (const message of sessionState.messages) all.set(message.id, message);
    return [
      ...all.values(),
      ...pendingMessages.filter((message) => message.threadRootId === null),
    ].sort((a, b) => a.createdAt - b.createdAt);
  }, [sessionState.messages, pendingMessages, messageContext]);

  const mergedDecrypted = useMemo(() => {
    const next = new Map(
      (messageContext?.history ?? []).map((message) => [message.id as string, message.body]),
    );
    for (const [id, text] of sessionState.decrypted) next.set(id, text);
    for (const item of pendingItems) {
      next.set(`pending:${item.id}`, item.text);
    }
    return next;
  }, [sessionState.decrypted, pendingItems, messageContext]);

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
      setQuote(null);
      setJumpToMessageId(null);
      setPane(1);
      const summary = channels.find((entry) => entry.id === channelId);
      if (runtime !== undefined && summary !== undefined) {
        await runtime.session.openChannel(summary);
      }
    },
    [runtime, channels],
  );

  const joinVoiceChannel = useCallback(
    (channelId: string) => {
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
      setPane(1);
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

  const recentKey = recentSearchKey(activeProfile?.baseUrl ?? workspaceName, ownUserId);

  const confirmSignOut = useCallback(() => {
    Alert.alert(`Sign out of ${workspaceName}?`, "You can sign back in at any time.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          void unregisterPush()
            .then(() => AsyncStorage.removeItem(recentKey).catch(() => undefined))
            .then(onSignOut)
            .catch(() => {
              Alert.alert(
                "Couldn't sign out",
                "Connect to your workspace and try again so notifications can be removed from this device.",
              );
            });
        },
      },
    ]);
  }, [workspaceName, onSignOut, unregisterPush, recentKey]);

  // Android back steps toward the hub's first tab before leaving the app.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (threadRoot !== null) return false;
      if (pane === 2) {
        setPane(1);
        return true;
      }
      if (pane === 1) {
        setPane(0);
        return true;
      }
      if (hubTab !== "chats") {
        setHubTab("chats");
        return true;
      }
      return false;
    });
    return () => {
      subscription.remove();
    };
  }, [pane, hubTab, threadRoot]);

  const goToPane = useCallback((next: PaneIndex) => {
    Keyboard.dismiss();
    selectionFeedback();
    setPane(next);
  }, []);

  const workspaceHost = useMemo(() => {
    const baseUrl = activeProfile?.baseUrl ?? "";
    try {
      return new URL(baseUrl).host;
    } catch {
      return baseUrl;
    }
  }, [activeProfile?.baseUrl]);
  // A private channel or direct message lists only its own people.
  const conversationMemberIds =
    channel !== undefined &&
    (channel.kind === "dm" || channel.kind === "group_dm" || channel.isPrivate === true)
      ? (channel.memberIds ?? [])
      : undefined;
  const shownProfile = useLingering(profileFor);
  const shownChannelAction = useLingering(channelAction);
  const shownMemberActions = useLingering(memberActionsFor);
  const dockClearance = useDockClearance();

  const channelTitle =
    channel === undefined ? workspaceName : (titles.get(channel.id) ?? channel.name);
  const isDirect = channel !== undefined && (channel.kind === "dm" || channel.kind === "group_dm");
  const partnerId = channel === undefined ? undefined : dmPartnerId(channel, ownUserId);
  const partnerPresence = presence.find((row) => row.userId === partnerId);
  const channelSubtitle =
    channel === undefined
      ? undefined
      : partnerId !== undefined
        ? partnerPresence?.customStatus || presenceLabel(partnerPresence?.status ?? "offline")
        : channel.kind === "group_dm"
          ? `${(channel.memberIds ?? []).length} people`
          : (channel.topic ?? (channel.kind === "announcement" ? "Announcements" : undefined));

  if (!ready || startupError !== null) {
    return (
      <View
        className="flex-1 items-center justify-center gap-4 bg-bg px-8"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        {!ready ? (
          <>
            <Spinner size={28} label="Opening workspace" />
            <Text size="sm" tone="muted">
              Opening {workspaceName}…
            </Text>
          </>
        ) : (
          <>
            <Text tone="danger" accessibilityRole="alert" className="text-center">
              {startupError}
            </Text>
            <Button onPress={retryStartup}>Try again</Button>
            <Button
              variant="ghost"
              onPress={() => {
                setWorkspaceSwitcherOpen(true);
              }}
            >
              Switch workspace
            </Button>
            <WorkspaceSwitcherSheet
              visible={workspaceSwitcherOpen}
              onClose={() => {
                setWorkspaceSwitcherOpen(false);
              }}
            />
          </>
        )}
      </View>
    );
  }

  const hub = (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      {hubTab === "chats" ? (
        <ChannelList
          workspaceName={workspaceName}
          channels={visibleChannels}
          categories={categories}
          titles={titles}
          activeChannelId={activeChannelId}
          ownUserId={ownUserId}
          presence={presence}
          members={members}
          workspaceHost={workspaceHost}
          onMemberPress={setProfileFor}
          hiddenCount={hiddenCount}
          showHidden={showHidden}
          canManageChannels={canManageChannels}
          activeCalls={voice.activeCalls}
          memberNames={memberNames}
          clientId={voice.clientId}
          localCallId={voice.callId}
          remoteLevels={voice.remoteLevels}
          onOpenChannel={(channelId) => void openChannel(channelId)}
          onChannelActions={(target) => {
            selectionFeedback();
            setChannelAction(target);
          }}
          onJoinVoice={joinVoiceChannel}
          threads={threadRows}
          onOpenThread={openThreadFromInbox}
          onOpenThreads={() => {
            setHubTab("threads");
          }}
          onCreateChannel={() => {
            setCreateError(null);
            setCreateOpen(true);
          }}
          onToggleHidden={() => {
            setShowHidden(!showHidden);
          }}
        />
      ) : hubTab === "dms" ? (
        <DirectList
          channels={visibleChannels}
          titles={titles}
          activeChannelId={activeChannelId}
          ownUserId={ownUserId}
          presence={presence}
          onOpenChannel={(channelId) => void openChannel(channelId)}
          onChannelActions={(target) => {
            selectionFeedback();
            setChannelAction(target);
          }}
          onNewMessage={() => {
            setNewMessageOpen(true);
          }}
        />
      ) : hubTab === "threads" ? (
        <View className="flex-1" style={{ paddingBottom: dockClearance }}>
          <PaneHeader
            title="Threads"
            subtitle="Conversations you replied to or were mentioned in"
            leading={
              <RoundButton
                icon="chevron-left"
                label="Back to channels"
                onPress={() => {
                  setHubTab("chats");
                }}
              />
            }
          />
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
        </View>
      ) : hubTab === "search" ? (
        <SearchView
          channels={channels}
          titles={titles}
          members={members}
          memberNames={memberNames}
          presence={presence}
          ownUserId={ownUserId}
          recentKey={recentKey}
          search={search}
          loadHistory={loadSearchHistory}
          onOpenMember={setProfileFor}
          onOpen={(id, messageId) => {
            void openChannel(id)
              .then(() => {
                setJumpToMessageId(messageId ?? null);
              })
              .catch((cause: unknown) => {
                Alert.alert("Couldn't open conversation", errorMessage(cause));
              });
          }}
        />
      ) : (
        <SettingsView
          workspaceName={workspaceName}
          ownUserId={ownUserId}
          ownDisplayName={memberNames.get(ownUserId) ?? ownDisplayName}
          canChangeNickname={hasPermission(viewerPermissions, Permission.ChangeOwnNickname)}
          hasAvatar={avatarUrls.has(ownUserId)}
          onChangeAvatar={() => {
            void (async () => {
              const file = (await pickFromLibrary()).at(0);
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
            })().catch(() => {
              Alert.alert("Couldn't update your profile picture.");
            });
          }}
          onClearAvatar={() => {
            void setAvatar({}).catch(() => {
              Alert.alert("Couldn't remove your profile picture.");
            });
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
          onSignOut={confirmSignOut}
        />
      )}
      <HubDock
        tab={hubTab}
        onTab={setHubTab}
        workspaceName={workspaceName}
        workspaceSeed={activeProfile?.iconSeed ?? workspaceName}
        onSwitchWorkspace={() => {
          setWorkspaceSwitcherOpen(true);
        }}
        ownUserId={ownUserId}
        ownStatus={ownStatus}
        threadBadge={threadMentionCount}
      />
    </View>
  );

  const chat = (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={-insets.bottom}
      style={{ flex: 1, backgroundColor: palette.bg, paddingTop: insets.top }}
    >
      <View className="flex-row items-center gap-3 border-b border-border px-3 pb-2 pt-1">
        <RoundButton
          icon="menu"
          label="Open conversations"
          onPress={() => {
            goToPane(0);
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${channelTitle}, show members`}
          onPress={() => {
            goToPane(2);
          }}
          className="min-h-11 min-w-0 flex-1 flex-row items-center gap-2.5 active:opacity-70"
        >
          {partnerId !== undefined ? (
            <PresenceAvatar
              userId={partnerId}
              status={partnerPresence?.status ?? "offline"}
              size={32}
              surface={palette.bg}
            />
          ) : (
            channel !== undefined &&
            !isDirect && (
              <Icon
                name={
                  channel.kind === "voice"
                    ? "volume"
                    : channel.isPrivate === true
                      ? "lock"
                      : channel.kind === "announcement"
                        ? "megaphone"
                        : "hash"
                }
                size={20}
                color={palette["text-muted"]}
              />
            )
          )}
          <View className="min-w-0 flex-1">
            <Text className="font-semibold" numberOfLines={1} maxFontSizeMultiplier={1.5}>
              {channelTitle}
            </Text>
            {channelSubtitle !== undefined && channelSubtitle.length > 0 && (
              <Text size="xs" tone="muted" numberOfLines={1} maxFontSizeMultiplier={1.5}>
                {channelSubtitle}
              </Text>
            )}
          </View>
        </Pressable>
        {channel !== undefined && isDirect && voice.canConnect && (
          <>
            <RoundButton
              icon="phone"
              label="Start voice call"
              onPress={() => void voice.startCall(channel.id, "voice")}
            />
            {voice.canVideo && (
              <RoundButton
                icon="video"
                label="Start video call"
                onPress={() => void voice.startCall(channel.id, "video")}
              />
            )}
          </>
        )}
        {channel !== undefined && hasPermission(channelPermissions, Permission.ReadHistory) && (
          <RoundButton
            icon="pin"
            label="Pinned messages"
            onPress={() => {
              setPinsOpen(true);
            }}
          />
        )}
        <RoundButton
          icon="users"
          label="Members"
          onPress={() => {
            goToPane(2);
          }}
        />
      </View>

      {channel === undefined ? (
        <View className="flex-1 items-center justify-center gap-3 px-8">
          <Text tone="muted" className="text-center">
            Pick a conversation to start.
          </Text>
          <Button
            variant="secondary"
            onPress={() => {
              goToPane(0);
            }}
          >
            Browse conversations
          </Button>
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
          onJoin={() => {
            joinVoiceChannel(channel.id);
          }}
        />
      ) : (
        <>
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
            hasOlder={sessionState.hasOlder}
            loadingOlder={sessionState.loadingOlder}
            onLoadOlder={sessionState.loadOlder}
            firstUnreadId={sessionState.unread.firstUnreadId}
            permissions={channelPermissions}
            jumpToMessageId={messageContext?.root.id ?? jumpToMessageId}
            onQuote={setQuote}
            onMemberPress={setProfileFor}
            onReply={(message) => {
              setThreadRoot(message);
            }}
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
            <Text size="xs" tone="muted" className="px-4 pb-1" accessibilityLiveRegion="polite">
              {typing}
            </Text>
          )}
          {pendingItems
            .filter((item) => item.status === "failed")
            .map((item) => (
              <View
                key={item.id}
                className="mx-3 mb-1.5 flex-row items-center gap-1 rounded-card bg-surface-2 py-1 pl-3 pr-1"
              >
                <Text size="sm" tone="danger" accessibilityRole="alert" className="flex-1">
                  Message couldn't be sent.
                </Text>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() =>
                    void retrySend(item.id).catch((cause: unknown) => {
                      Alert.alert("Couldn't retry message", errorMessage(cause));
                    })
                  }
                >
                  Retry
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() =>
                    void discardSend(item.id).catch((cause: unknown) => {
                      Alert.alert("Couldn't discard message", errorMessage(cause));
                    })
                  }
                >
                  Discard
                </Button>
              </View>
            ))}
          {quote !== null && (
            <View className="flex-row items-center gap-2 border-t border-border py-1.5 pl-4 pr-2">
              <Icon name="reply" size={14} color={palette.accent} />
              <Text size="xs" numberOfLines={1} className="min-w-0 flex-1">
                <Text size="xs" className="font-semibold">
                  {memberNames.get(quote.authorId) ?? "Member"}
                </Text>
                <Text size="xs" tone="muted">
                  {"  "}
                  {(sessionState.decrypted.get(quote.id) ?? quote.body).replace(/\s+/g, " ").trim()}
                </Text>
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel reply"
                hitSlop={12}
                onPress={() => {
                  setQuote(null);
                }}
                className="h-7 w-7 items-center justify-center rounded-pill active:bg-surface-3"
              >
                <Icon name="x" size={14} color={palette["text-muted"]} />
              </Pressable>
            </View>
          )}
          <Composer
            disabled={
              channel.archived || !hasPermission(channelPermissions, Permission.SendMessages)
            }
            channelId={channel.id}
            placeholder={isDirect ? `Message ${channelTitle}` : `Message #${channelTitle}`}
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
                ...(quote !== null ? { replyToId: quote.id } : {}),
                ...(mentionUserIds.length > 0 ? { mentionUserIds } : {}),
                ...(channelMentions.channelIds.length > 0
                  ? { mentionChannelIds: channelMentions.channelIds }
                  : {}),
                ...(channelMentions.categoryIds.length > 0
                  ? { mentionCategoryIds: channelMentions.categoryIds }
                  : {}),
                ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
              });
              setQuote(null);
              if (!result.queued && result.messageId !== undefined) {
                void runtime.session.markRead(channel.id, result.messageId);
              }
            }}
          />
        </>
      )}
    </KeyboardAvoidingView>
  );

  return (
    <BottomSheetModalProvider>
      <View className="flex-1 bg-bg">
        <SwipePanes
          index={pane}
          onIndexChange={(next) => {
            selectionFeedback();
            setPane(next);
          }}
          left={hub}
          center={chat}
          right={
            <MembersPane
              memberIds={conversationMemberIds}
              channelTitle={channelTitle}
              members={members}
              presence={presence}
              ownUserId={ownUserId}
              canModerateMembers={canModerateMembers}
              onBack={() => {
                goToPane(1);
              }}
              onMemberPress={setProfileFor}
              onMemberActions={(userId) => {
                setModerationError(null);
                setMemberActionsFor(userId);
              }}
              onOpenBans={
                canBan
                  ? () => {
                      setBansOpen(true);
                    }
                  : undefined
              }
            />
          }
        />

        {threadRoot !== null && channel !== undefined && runtime !== undefined && (
          <ThreadModal
            runtime={runtime}
            permissions={channelPermissions}
            channelId={channel.id}
            channelTitle={isDirect ? channelTitle : `#${channelTitle}`}
            root={threadRoot}
            outbox={outbox}
            rootText={mergedDecrypted.get(threadRoot.id) ?? threadRoot.body}
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
            onClose={() => {
              setThreadRoot(null);
            }}
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

        <BottomSheet
          visible={channelAction !== null}
          title={
            shownChannelAction === null
              ? ""
              : (titles.get(shownChannelAction.id) ?? shownChannelAction.name)
          }
          subtitle={shownChannelAction?.topic ?? undefined}
          onClose={() => {
            setChannelAction(null);
          }}
        >
          {shownChannelAction !== null && (
            <ListGroup>
              <ListRow
                icon={shownChannelAction.muted === true ? "bell" : "bell-off"}
                title={shownChannelAction.muted === true ? "Unmute" : "Mute"}
                subtitle={
                  shownChannelAction.muted === true ? undefined : "No sounds or badges from here"
                }
                onPress={() => void toggleMute(shownChannelAction)}
              />
              <ListRow
                icon={shownChannelAction.hidden === true ? "eye" : "eye-off"}
                title={shownChannelAction.hidden === true ? "Show in list" : "Hide from list"}
                onPress={() => void toggleHide(shownChannelAction)}
              />
              {shownChannelAction.id === activeChannelId && (
                <ListRow icon="check" title="Mark as read" onPress={() => void markChannelRead()} />
              )}
              {canManageChannels &&
                (shownChannelAction.kind === "text" ||
                  shownChannelAction.kind === "announcement") && (
                  <ListRow
                    icon="pencil"
                    title="Edit channel"
                    chevron
                    onPress={() => {
                      setEditChannelError(null);
                      setEditChannelModal(shownChannelAction);
                      setChannelAction(null);
                    }}
                  />
                )}
            </ListGroup>
          )}
        </BottomSheet>

        {channel !== undefined && (
          <PinnedMessagesSheet
            visible={pinsOpen}
            channelId={channel.id}
            memberNames={memberNames}
            onClose={() => {
              setPinsOpen(false);
            }}
            onOpen={setJumpToMessageId}
          />
        )}

        {shownProfile !== null && (
          <MemberProfileSheet
            visible={profileFor !== null}
            userId={shownProfile}
            displayName={memberNames.get(shownProfile) ?? "Member"}
            status={presence.find((row) => row.userId === shownProfile)?.status ?? "offline"}
            customStatus={presence.find((row) => row.userId === shownProfile)?.customStatus ?? ""}
            ownUserId={ownUserId}
            onClose={() => {
              setProfileFor(null);
            }}
            onNote={() => {
              setNoteFor(shownProfile);
              setProfileFor(null);
            }}
            onModerate={
              canModerateMembers && shownProfile !== ownUserId && shownProfile !== ownerUserId
                ? () => {
                    setProfileFor(null);
                    setModerationError(null);
                    setMemberActionsFor(shownProfile);
                  }
                : undefined
            }
            onMessage={() => {
              setProfileFor(null);
              void runtime?.port
                .createDm({ otherUserId: shownProfile })
                .then((result) => openChannel(result.channelId))
                .catch((cause: unknown) => {
                  Alert.alert("Couldn't start message", errorMessage(cause));
                });
            }}
          />
        )}

        <MemberActionsSheet
          visible={memberActionsFor !== null}
          memberName={
            shownMemberActions === null
              ? ""
              : (memberNames.get(shownMemberActions) ?? shownMemberActions)
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

        <WorkspaceSwitcherSheet
          visible={workspaceSwitcherOpen}
          onClose={() => {
            setWorkspaceSwitcherOpen(false);
          }}
        />

        {newMessageOpen && (
          <NewConversationSheet
            members={members}
            ownUserId={ownUserId}
            onClose={() => {
              setNewMessageOpen(false);
            }}
            onCreate={async (ids) => {
              if (runtime === undefined) throw new Error("Wait for the workspace to connect.");
              const result =
                ids.length === 1
                  ? await runtime.port.createDm({ otherUserId: ids[0] ?? "" })
                  : await runtime.port.createGroupDm({ memberIds: ids });
              setNewMessageOpen(false);
              await openChannel(result.channelId);
            }}
          />
        )}

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

        {canBan && (
          <BannedMembersSheet
            visible={bansOpen}
            memberNames={memberNames}
            onClose={() => {
              setBansOpen(false);
            }}
          />
        )}

        <CreateChannelSheet
          visible={createOpen}
          categories={categories}
          busy={createBusy}
          error={createError}
          onCreateChannel={create}
          onCreateCategory={createNewCategory}
          onClose={() => {
            setCreateOpen(false);
          }}
        />

        {noteFor !== null && runtime !== undefined && (
          <UserNoteSheet
            visible
            memberName={memberNames.get(noteFor) ?? noteFor}
            loadNote={() => getUserNote(runtime.client, noteFor)}
            onSave={(body) => setUserNote(runtime.client, noteFor, body)}
            onClose={() => {
              setNoteFor(null);
            }}
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
      </View>
    </BottomSheetModalProvider>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "Something went wrong. Please try again.";
}
