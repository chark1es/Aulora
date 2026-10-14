import {
  ALL_PERMISSIONS,
  type ChannelSummary,
  type ChannelView,
  DEFAULT_VOICE_SETTINGS,
  type MessagePayload,
  type PresenceRow,
} from "@aulora/core";
import type { ConvexReactClient } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import type { ThreadInboxItem } from "../components/chat/ThreadsInbox";
import type { ChatScreenSession, MemberProfileData } from "../components/chat/use-chat-screen-data";
import type { CategoryView, MobileMemberEntry } from "../providers/ChatProvider";
import { EMPTY_SNAPSHOT, type VoiceContextValue } from "../providers/voice-provider-types";
import type { MobileChatRuntime } from "./chat-runtime";
import { REVIEW_MEMBERS, REVIEW_USER_ID, type ReviewDemo } from "./review-demo";

/**
 * Everything the offline demo needs to render the *real* chat surface: a
 * session shaped exactly like the signed-in one, backed by the in-memory port
 * instead of a server. Because the panes read this same interface, any UI the
 * app gains shows up in the demo without a parallel implementation.
 */

const DEMO_WORKSPACE = "Acme Studio";
const DEMO_MEMBER_NAMES = new Map(
  REVIEW_MEMBERS.map((member) => [member.userId, member.displayName]),
);

const DEMO_PROFILES = new Map<string, MemberProfileData>([
  ["me", { bio: "Design lead. Keeping the launch on track.", lastOnlineAt: null }],
  ["sam", { bio: "Product. Ask me about the roadmap.", lastOnlineAt: null }],
  ["jordan", { bio: "Engineering. I care about the details.", lastOnlineAt: null }],
]);

/** A member list the channel-edit and mention pickers can read. */
const DEMO_MEMBER_ENTRIES: readonly MobileMemberEntry[] = REVIEW_MEMBERS.map((member) => ({
  userId: member.userId,
  displayName: member.displayName,
  roleIds: [],
  isOwner: member.userId === REVIEW_USER_ID,
  roleColor: null,
}));

/**
 * Calls are server-backed, so the demo presents calls as unavailable: the shared
 * header hides its call buttons and the call screens idle. No microphone or
 * camera is touched, and no call is ever placed.
 */
function demoVoice(): VoiceContextValue {
  return {
    ...EMPTY_SNAPSHOT,
    selfUserId: REVIEW_USER_ID,
    clientId: null,
    policy: {
      enabled: false,
      videoEnabled: false,
      screenShareEnabled: false,
      maxParticipants: 0,
      iceServers: [],
    },
    incoming: [],
    activeCalls: [],
    settings: DEFAULT_VOICE_SETTINGS,
    devices: [],
    canConnect: false,
    canSpeak: false,
    canStream: false,
    canVideo: false,
    view: "hidden",
    pipPinned: false,
    pip: { supported: false, active: false, enter: () => undefined },
    setView: () => undefined,
    setPipPinned: () => undefined,
    startCall: async () => null,
    joinCall: async () => false,
    acceptCall: async () => undefined,
    declineCall: async () => undefined,
    leave: async () => undefined,
    endCall: async () => undefined,
    setMuted: async () => undefined,
    setDeafened: () => undefined,
    setCamera: async () => undefined,
    setScreenSharing: async () => undefined,
    updateSettings: async () => undefined,
    refreshDevices: async () => undefined,
    clearError: () => undefined,
  };
}

function toChannelView(channel: ChannelSummary): ChannelView {
  return { ...channel, name: channel.name ?? "Direct message" };
}

/**
 * Puts a chosen conversation first so it opens by default. Only the screenshot
 * capture uses this; the live demo keeps the workspace order.
 */
function orderChannels(
  channels: readonly ChannelView[],
  firstName: string | undefined,
): readonly ChannelView[] {
  if (firstName === undefined) return channels;
  const chosen = channels.find((channel) => channel.name === firstName);
  if (chosen === undefined) return channels;
  return [chosen, ...channels.filter((channel) => channel.id !== chosen.id)];
}

/** Live channel list from the mock port, named like the signed-in app names them. */
function useChannels(demo: ReviewDemo): readonly ChannelView[] {
  const [channels, setChannels] = useState<readonly ChannelSummary[]>([]);
  useEffect(() => demo.port.watchChannels(setChannels), [demo]);
  return useMemo(() => channels.map(toChannelView), [channels]);
}

function usePresence(demo: ReviewDemo): readonly PresenceRow[] {
  const [presence, setPresence] = useState<readonly PresenceRow[]>([]);
  useEffect(() => demo.port.watchPresence(setPresence), [demo]);
  return presence;
}

/** Root messages per channel, so threads and pins stay live as the demo is used. */
function useMessageRoots(demo: ReviewDemo, channelIds: readonly string[]) {
  const [byChannel, setByChannel] = useState<ReadonlyMap<string, readonly MessagePayload[]>>(
    new Map(),
  );
  useEffect(() => {
    const listeners = channelIds.map((channelId) =>
      demo.port.watchMessages(channelId, (messages) => {
        setByChannel((current) => {
          const next = new Map(current);
          next.set(channelId, messages);
          return next;
        });
      }),
    );
    return () => {
      for (const off of listeners) off();
    };
  }, [demo, channelIds]);
  return byChannel;
}

function threadRowsFrom(
  byChannel: ReadonlyMap<string, readonly MessagePayload[]>,
): ThreadInboxItem[] {
  const rows: ThreadInboxItem[] = [];
  for (const messages of byChannel.values()) {
    for (const message of messages) {
      const replyCount = message.replyCount ?? 0;
      if (message.threadRootId !== null || replyCount <= 0) continue;
      rows.push({
        id: message.id,
        channelId: message.channelId,
        authorId: message.authorId,
        body: message.body,
        createdAt: message.createdAt,
        replyCount,
        lastReplyAt: message.lastReplyAt ?? null,
        participantIds: [],
        mentionedUserIds: message.mentionUserIds,
        viewerParticipated: true,
        viewerMentioned: message.mentionUserIds.includes(REVIEW_USER_ID),
      });
    }
  }
  return rows.sort((a, b) => (b.lastReplyAt ?? b.createdAt) - (a.lastReplyAt ?? a.createdAt));
}

/** Placeholder used before the mock workspace exists, so hooks always run. */
const FALLBACK_DEMO = {
  port: {
    watchChannels: () => () => undefined,
    watchPresence: () => () => undefined,
    watchMessages: () => () => undefined,
  },
} as unknown as ReviewDemo;

/**
 * Server-only writes (category create, private notes) resolve locally so those
 * sheets stay usable offline; nothing here reaches a network.
 */
const DEMO_CLIENT = {
  mutation: async () => "demo",
  query: async () => ({ body: null }),
} as unknown as ConvexReactClient;

/**
 * Builds the offline session once the mock workspace is ready. `undefined` until
 * then, so the demo screen can hold its own loading state.
 */
export function useReviewDemoSession(
  demo: ReviewDemo | undefined,
  initialChannelName?: string,
): ChatScreenSession | undefined {
  const activeDemo = demo ?? FALLBACK_DEMO;
  const channels = useChannels(activeDemo);
  const presence = usePresence(activeDemo);
  const channelIds = useMemo(() => channels.map((channel) => channel.id), [channels]);
  const orderedChannels = useMemo(
    () => orderChannels(channels, initialChannelName),
    [channels, initialChannelName],
  );
  const byChannel = useMessageRoots(activeDemo, channelIds);
  const voice = useMemo(demoVoice, []);

  return useMemo<ChatScreenSession | undefined>(() => {
    if (demo === undefined) {
      return undefined;
    }
    const runtime: MobileChatRuntime = { ...demo.runtime, client: DEMO_CLIENT };
    const threadRows = threadRowsFrom(byChannel);
    const pinsFor = (channelId: string): readonly MessagePayload[] =>
      (byChannel.get(channelId) ?? []).filter((message) => message.pinnedAt !== null);
    const categories: readonly CategoryView[] = [];
    // Avatar uploads are server-only; the shared settings sheet only calls these
    // on tap, where the real mutation shape is required but never reached.
    const unavailableMutation = (() =>
      Promise.reject(
        new Error("Profile pictures need a real server."),
      )) as unknown as ChatScreenSession["generateAvatarUploadUrl"];
    const session: ChatScreenSession = {
      runtime,
      ready: true,
      startupError: null,
      retryStartup: () => undefined,
      channels: orderedChannels,
      categories,
      presence,
      outbox: [],
      members: DEMO_MEMBER_ENTRIES,
      memberRoleGroups: [],
      avatarUrls: new Map(),
      roles: [],
      roleViews: [],
      viewerPermissions: ALL_PERMISSIONS,
      viewerTopPosition: Number.POSITIVE_INFINITY,
      isOwner: true,
      ownerUserId: REVIEW_USER_ID,
      canManageChannels: true,
      canKick: false,
      canBan: false,
      canTimeout: false,
      canModerateMembers: false,
      canMentionEveryone: true,
      sendMessage: async (channelId, text, options = {}) => {
        const attachmentIds = (options.attachments ?? []).map((file) => file.fileId);
        const messageId = await demo.runtime.session.sendMessage(channelId, text, {
          ...(options.mentionUserIds !== undefined
            ? { mentionUserIds: options.mentionUserIds }
            : {}),
          ...(options.mentionChannelIds !== undefined
            ? { mentionChannelIds: options.mentionChannelIds }
            : {}),
          ...(options.mentionCategoryIds !== undefined
            ? { mentionCategoryIds: options.mentionCategoryIds }
            : {}),
          ...(options.threadRootId !== undefined ? { threadRootId: options.threadRootId } : {}),
          ...(options.replyToId !== undefined ? { replyToId: options.replyToId } : {}),
          ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
        });
        return { queued: false, messageId };
      },
      retrySend: async () => undefined,
      discardSend: async () => undefined,
      search: async (query) => demo.search(query),
      loadSearchHistory: async () => true,
      permissionsFor: () => ALL_PERMISSIONS,
      workspaceName: DEMO_WORKSPACE,
      ownUserId: REVIEW_USER_ID,
      ownDisplayName: DEMO_MEMBER_NAMES.get(REVIEW_USER_ID) ?? "Alex Rivera",
      generateAvatarUploadUrl: unavailableMutation,
      setAvatar: unavailableMutation,
      activeProfile: undefined,
      voice,
      sound: null,
      pushState: "unavailable",
      unregisterPush: async () => undefined,
      showKanban: false,
      showNotes: false,
      threadRows: threadRows as unknown as ChatScreenSession["threadRows"],
      threadMentionCount: threadRows.filter((row) => row.viewerMentioned).length,
      pinsFor,
      profiles: DEMO_PROFILES,
      viewerProfile: { nickname: null, bio: DEMO_PROFILES.get(REVIEW_USER_ID)?.bio ?? "" },
    };
    return session;
  }, [demo, orderedChannels, presence, byChannel, voice]);
}
