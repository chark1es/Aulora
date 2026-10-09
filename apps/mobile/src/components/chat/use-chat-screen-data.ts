import {
  type AttachmentDescriptor,
  type ChannelView,
  conversationTitle,
  dmPartnerId,
  hasPermission,
  type MessagePayload,
  Permission,
} from "@aulora/core";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef } from "react";
import { Platform } from "react-native";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { useIncomingCallNotification, useLocalNotifications } from "../../lib/notifications";
import { presenceLabel, typingLabel } from "../../lib/presence";
import { recentSearchKey } from "../../lib/search-ui";
import { useChannelSession } from "../../lib/use-channel";
import { usePushRegistration } from "../../lib/use-push-registration";
import { useChat } from "../../providers/ChatProvider";
import { useProfiles } from "../../providers/ProfileProvider";
import { useSound } from "../../providers/SoundProvider";
import { useVoice } from "../../providers/VoiceProvider";
import type { ChatScreenProps } from "./chat-screen-types";
import { type ChatScreenUiState, useChatScreenUiState } from "./use-chat-screen-ui-state";

function useChatScreenSession(workspaceName: string, ownUserId: string, ownDisplayName: string) {
  const chat = useChat();
  const generateAvatarUploadUrl = useMutation(api.members.generateAvatarUploadUrl);
  const setAvatar = useMutation(api.members.setAvatar);
  const { activeProfile } = useProfiles();
  const voice = useVoice();
  const sound = useSound();
  const { state: pushState, unregister: unregisterPush } = usePushRegistration(
    chat.runtime?.client,
    Platform.OS === "ios" ? "ios" : "android",
  );
  const publicConfig = useQuery(api.server.publicConfig, {});
  const showKanban =
    publicConfig?.addons?.kanban === true &&
    hasPermission(chat.viewerPermissions, Permission.ViewKanban);
  const showNotes =
    publicConfig?.addons?.notes === true &&
    hasPermission(chat.viewerPermissions, Permission.ViewNotes);
  const threadRows = useQuery(api.messages.threadInbox, {});
  const threadMentionCount = useMemo(
    () => (threadRows ?? []).filter((row) => row.viewerMentioned).length,
    [threadRows],
  );
  return {
    ...chat,
    workspaceName,
    ownUserId,
    ownDisplayName,
    generateAvatarUploadUrl,
    setAvatar,
    activeProfile,
    voice,
    sound,
    pushState,
    unregisterPush,
    showKanban,
    showNotes,
    threadRows,
    threadMentionCount,
  };
}

export type ChatScreenSession = ReturnType<typeof useChatScreenSession>;

function useChatScreenMentions(session: ChatScreenSession) {
  const { channels, categories, members, presence, ownUserId, ownDisplayName, voice } = session;
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

  return {
    channelNames,
    textChannelNames,
    mentionChannelTargets,
    mentionChannelOptions,
    mentionCategoryTargets,
    mentionNames,
    mentionUserTargets,
    mentionMemberIds,
    memberNames,
    memberColors,
  };
}

export type ChatScreenMentions = ReturnType<typeof useChatScreenMentions>;

function useChatScreenChannelList(
  session: ChatScreenSession,
  ui: ChatScreenUiState,
  mentions: ChatScreenMentions,
) {
  const { channels, runtime, ownUserId, sound } = session;
  const { showHidden, activeChannelId, setActiveChannelId } = ui;
  const { channelNames, memberNames } = mentions;

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
  }, [channels, activeChannelId, setActiveChannelId]);

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

  return { visibleChannels, hiddenCount, titles };
}

export type ChatScreenChannelList = ReturnType<typeof useChatScreenChannelList>;

function useChatScreenCallCues(
  voice: ChatScreenSession["voice"],
  sound: ChatScreenSession["sound"],
) {
  const callParticipantCount = voice.call?.participants.length ?? 0;
  const connectedRef = useRef(false);
  const participantCountRef = useRef(0);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  useEffect(() => {
    if (callParticipantCount === 0) {
      connectedRef.current = false;
      participantCountRef.current = 0;
      return;
    }
    if (!connectedRef.current) {
      connectedRef.current = true;
      participantCountRef.current = callParticipantCount;
      soundRef.current?.play("call-connect");
      return;
    }
    const previous = participantCountRef.current;
    participantCountRef.current = callParticipantCount;
    if (callParticipantCount > previous) {
      soundRef.current?.play("call-join");
    } else if (callParticipantCount < previous) {
      soundRef.current?.play("call-leave");
    }
  }, [callParticipantCount]);

  const incomingCount = voice.incoming.length;
  useEffect(() => {
    if (incomingCount > 0) {
      soundRef.current?.play("call-ring");
    }
  }, [incomingCount]);
}

function useChatScreenConversation(
  session: ChatScreenSession,
  ui: ChatScreenUiState,
  mentions: ChatScreenMentions,
  list: ChatScreenChannelList,
) {
  const {
    channels,
    presence,
    runtime,
    viewerPermissions,
    permissionsFor,
    ownUserId,
    voice,
    sound,
  } = session;
  const { activeChannelId, jumpToMessageId, setThreadRoot } = ui;
  const { memberNames } = mentions;
  const { titles } = list;

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
  }, [messageContext, runtime, setThreadRoot]);

  useChatScreenCallCues(voice, sound);

  const meta = useChatScreenConversationMeta({
    activeProfile: session.activeProfile,
    workspaceName: session.workspaceName,
    presence,
    titles,
    ...(channel !== undefined ? { channel } : {}),
    typers: sessionState.typers,
    ownUserId,
    memberNames,
  });

  return {
    channel,
    channelPermissions,
    sessionState,
    messageContext,
    ...meta,
  };
}

function useChatScreenConversationMeta(input: {
  readonly activeProfile: ChatScreenSession["activeProfile"];
  readonly workspaceName: string;
  readonly presence: ChatScreenSession["presence"];
  readonly titles: ChatScreenChannelList["titles"];
  readonly channel?: ChannelView;
  readonly typers: ReturnType<typeof useChannelSession>["typers"];
  readonly ownUserId: string;
  readonly memberNames: Map<string, string>;
}) {
  const {
    activeProfile,
    workspaceName,
    presence,
    titles,
    channel,
    typers,
    ownUserId,
    memberNames,
  } = input;
  const typing = typingLabel(typers, ownUserId, (userId) => memberNames.get(userId) ?? userId);

  const recentKey = recentSearchKey(activeProfile?.baseUrl ?? workspaceName, ownUserId);

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

  const channelTitle =
    channel === undefined ? workspaceName : (titles.get(channel.id) ?? channel.name);
  const isDirect = channel !== undefined && (channel.kind === "dm" || channel.kind === "group_dm");
  const partnerId = channel === undefined ? undefined : dmPartnerId(channel, ownUserId);
  const partnerPresence = presence.find((row) => row.userId === partnerId);
  const channelSubtitle = channelSubtitleFor(partnerId, channel, partnerPresence);

  return {
    typing,
    recentKey,
    workspaceHost,
    conversationMemberIds,
    channelTitle,
    isDirect,
    partnerId,
    partnerPresence,
    channelSubtitle,
  };
}

function channelSubtitleFor(
  partnerId: string | undefined,
  channel?: ChannelView,
  partnerPresence?: ChatScreenSession["presence"][number],
): string | undefined {
  if (channel === undefined) {
    return undefined;
  }
  if (partnerId !== undefined) {
    return partnerPresence?.customStatus || presenceLabel(partnerPresence?.status ?? "offline");
  }
  if (channel.kind === "group_dm") {
    return `${(channel.memberIds ?? []).length} people`;
  }
  return channel.topic ?? (channel.kind === "announcement" ? "Announcements" : undefined);
}

export type ChatScreenConversation = ReturnType<typeof useChatScreenConversation>;

function useChatScreenMessages(
  session: ChatScreenSession,
  ui: ChatScreenUiState,
  conversation: ChatScreenConversation,
) {
  const { runtime, outbox, ownUserId } = session;
  const { activeChannelId } = ui;
  const { sessionState, messageContext } = conversation;

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

  return {
    attachmentsByMessage,
    pendingItems,
    mergedMessages,
    mergedDecrypted,
    pendingIds,
  };
}

export function useChatScreenData({
  workspaceName,
  ownUserId,
  ownDisplayName,
  onSignOut,
}: ChatScreenProps) {
  const session = useChatScreenSession(workspaceName, ownUserId, ownDisplayName);
  const ui = useChatScreenUiState();
  const mentions = useChatScreenMentions(session);
  const list = useChatScreenChannelList(session, ui, mentions);
  const conversation = useChatScreenConversation(session, ui, mentions, list);
  const messages = useChatScreenMessages(session, ui, conversation);

  const ownPresence = session.presence.find((row) => row.userId === ownUserId);
  const ownStatus = ownPresence?.status ?? "offline";
  const ownCustomStatus = ownPresence?.customStatus ?? "";

  return {
    onSignOut,
    ...session,
    ...ui,
    ...mentions,
    ...list,
    ...conversation,
    ...messages,
    ownStatus,
    ownCustomStatus,
  };
}

export type ChatScreenData = ReturnType<typeof useChatScreenData>;
