import {
  type AttachmentDescriptor,
  buildPresenceScope,
  type ChannelView,
  canUseMassMentions,
  canViewScheduledCalls,
  canViewTranscripts,
  conversationTitle,
  createTypingThrottle,
  hasBroadcastToken,
  hasPermission,
  type MembersGroupingRole,
  type MentionTarget,
  type MessagePayload,
  messageMentionsUser,
  Permission,
  PRESENCE_SCOPE_MAX,
  type RoleMentionTarget,
  resolveServerCapabilities,
  suppressesBroadcast,
  userFacingError,
} from "@aulora/core";
import { ConfirmDialog, cn, EmptyState, Icon, Spinner } from "@aulora/ui-web";
import { useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { DEFAULT_MAX_UPLOAD_BYTES, uploadFiles } from "../../lib/attachments";
import { selectEagerChannelIds } from "../../lib/channel-priority";
import { isChatCanvasOnScreen, isThreadsInboxOnScreen } from "../../lib/chat-surface";
import { isDesktop } from "../../lib/desktop";
import { publicOriginOrNull, publicUrl } from "../../lib/public-origin";
import { sendThreadReply } from "../../lib/send-thread-reply";
import { playSound } from "../../lib/sounds";
import { useChannelSession } from "../../lib/use-channel";
import {
  showUnfocusedNotification,
  useDesktopNotifications,
} from "../../lib/use-desktop-notifications";
import { useUnreadBadge } from "../../lib/use-desktop-unread";
import { useMemberPages } from "../../lib/use-member-pages";
import { useSettingsNavigation } from "../../lib/use-settings-navigation";
import { useUnopenedChannelAlerts } from "../../lib/use-unopened-channel-alerts";
import { useVisitedViews } from "../../lib/use-visited-views";
import { useWebPush } from "../../lib/use-web-push";
import { useWideShell } from "../../lib/use-wide-shell";
import {
  type CategoryView,
  type MemberView,
  memberDisplayName,
  type RoleView,
  resolveViewerPermissions,
  roleColorFor,
  roleNamesFor,
  roleRef,
} from "../../lib/workspace-admin";
import { type ChatSearchHit, useChat } from "../../providers/ChatProvider";
import { useDesktopUpdates } from "../../providers/DesktopUpdateProvider";
import { useVoice } from "../../providers/VoiceProvider";
import {
  useWorkspaceUpdates,
  WorkspaceUpdateProvider,
} from "../../providers/WorkspaceUpdateProvider";
import type { AdminPanelViewer } from "../admin/AdminPanel";
import { KeepAlive } from "../KeepAlive";
import { DesktopUpdateSettings } from "../UpdateSettings";
import { CallPictureInPicture } from "../voice/CallPictureInPicture";
import { DeviceSettingsSection } from "../voice/DeviceSettingsSection";
import { IncomingCallModal } from "../voice/IncomingCallModal";
import type { CallIdentity } from "../voice/identity";
import { WorkspaceMenu } from "../WorkspaceMenu";
import { ChannelMembersModal } from "./ChannelMembersModal";
import { ChannelPane } from "./ChannelPane";
import { ChannelSidebar, type ChannelUnread } from "./ChannelSidebar";
import { CreateCategoryModal } from "./CreateCategoryModal";
import { type CreateChannelInput, CreateChannelModal } from "./CreateChannelModal";
import { channelEditBaseline, commitChannelEdit } from "./channel-edit";
import {
  type ChannelRoleOption,
  canEditChannelRole,
  mergeRoleOverrides,
  roleOverridesFor,
  sameOverrides,
} from "./channel-role-overrides";
import { EditChannelModal, type EditChannelPatch } from "./EditChannelModal";
import { MemberProfilePopover } from "./MemberProfilePopover";
import { type MemberEntry, MembersPanel } from "./MembersPanel";
import { MemberAvatarProvider } from "./member-avatars";
import { NewConversationDialog } from "./NewConversationDialog";
import { NotificationsSettingsSection } from "./NotificationsSettingsSection";
import type { PresenceStatus } from "./PresenceAvatar";
import { RenameChannelModal } from "./RenameChannelModal";
import { type RestoreTracking, restoreMentionedChannels } from "./restore-channels";
import { type SearchArchiveState, SearchPanel } from "./SearchPanel";
import { type ThreadInboxItem, ThreadsInbox } from "./ThreadsInbox";
import { ThreadsPanel } from "./ThreadsPanel";
import { UserSettingsView } from "./UserSettingsView";

// Heavy surfaces only render conditionally (admin, board, notes, a call). Load
// them on demand so the signed-in shell does not ship their code up front.
const AdminPanel = lazy(() =>
  import("../admin/AdminPanel").then((module) => ({ default: module.AdminPanel })),
);
const KanbanView = lazy(() =>
  import("../kanban/KanbanView").then((module) => ({ default: module.KanbanView })),
);
const NotesView = lazy(() =>
  import("../notes/NotesView").then((module) => ({ default: module.NotesView })),
);
const ScheduledCallsView = lazy(() =>
  import("../scheduled/ScheduledCallsView").then((module) => ({
    default: module.ScheduledCallsView,
  })),
);
const TranscriptsView = lazy(() =>
  import("../transcripts/TranscriptsView").then((module) => ({
    default: module.TranscriptsView,
  })),
);
const InviteGuestDialog = lazy(() =>
  import("../voice/InviteGuestDialog").then((module) => ({ default: module.InviteGuestDialog })),
);
const GuestLobbyPrompt = lazy(() =>
  import("../voice/GuestLobbyPrompt").then((module) => ({ default: module.GuestLobbyPrompt })),
);
const CallStage = lazy(() =>
  import("../voice/CallStage").then((module) => ({ default: module.CallStage })),
);
const CallDock = lazy(() =>
  import("../voice/CallDock").then((module) => ({ default: module.CallDock })),
);
const VoiceChannelView = lazy(() =>
  import("../voice/VoiceChannelView").then((module) => ({ default: module.VoiceChannelView })),
);

/** Centered placeholder shown while a lazily-loaded surface streams in. */
function SurfaceFallback() {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <Spinner size={24} label="Loading" />
    </div>
  );
}

export interface ChatViewProps {
  readonly workspaceName: string;
  readonly workspaceIconSeed: string;
  readonly ownUserId: string;
  readonly ownName: string;
  readonly permissions: bigint;
  readonly kanbanEnabled?: boolean;
  readonly notesEnabled?: boolean;
  /** The viewer’s own workspace avatar, if they set one. */
  readonly ownAvatarUrl: string | null;
  /**
   * Extra directory rows for a host that supplies its own people instead of a
   * Convex backend (the dev `/__preview` surface). Merged over the scoped
   * lookup; production never passes it.
   */
  readonly membersFallback?: readonly MemberEntry[];
  readonly roles: readonly RoleMentionTarget[];
  /** Live per-channel unread state from the server, keyed by channel id. */
  readonly unreadByChannel: ReadonlyMap<string, ChannelUnread>;
  readonly admin: {
    readonly viewer: AdminPanelViewer;
    readonly ownerIds: readonly string[];
    /** False against a backend that predates multiple-owner management. */
    readonly ownerManagementAvailable: boolean;
    readonly roleViews: readonly RoleView[];
    readonly categories: readonly CategoryView[];
  };
  readonly onSignOut: () => void;
}

/** Ids one `members.brief` call resolves (matches the server’s cap). */
const MEMBER_DIRECTORY_MAX = 300;
/** Member panel page size, grown by one step per "Show more". */
const MEMBER_PAGE_INITIAL = 100;
/** Roster rows loaded for pickers, the admin surface and the addons. */
const MEMBER_ROSTER_PAGE = 500;
/** Threads returned by the open inbox (server caps at 50). */
const THREAD_INBOX_PAGE = 50;
/** Stable empty roster so `skip`ped pages do not allocate a new array. */
const EMPTY_MEMBERS: readonly MemberView[] = [];

const LAST_CHANNEL_KEY = "aulora.lastChannel.v1:";
const MEMBERS_OPEN_KEY = "aulora.membersOpen.v1";
const MESSAGE_ALIGNMENT_KEY = "aulora.messageAlignment.v1";
function errorMessage(error: unknown): string {
  return userFacingError(error);
}

/** Whether two id lists hold the same distinct values, order-insensitive. */
function readLocal(key: string): string | null {
  try {
    return globalThis.localStorage.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    globalThis.localStorage.setItem(key, value);
  } catch {
    // Preferences are best-effort.
  }
}

function readAttentive(): boolean {
  return (
    typeof document === "undefined" ||
    (document.visibilityState === "visible" && document.hasFocus())
  );
}

/** Whether the page is visible and focused, i.e. the reader can see new messages. */
function useAttentive(): boolean {
  const [attentive, setAttentive] = useState(readAttentive);
  useEffect(() => {
    const update = () => {
      setAttentive(readAttentive());
    };
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, []);
  return attentive;
}

/**
 * The signed-in chat surface: sidebar, conversation, thread or member panel,
 * the quick switcher and admin sheets. Reads the chat session from
 * {@link useChat}; message bodies and channel names are plaintext.
 */
export function ChatView(props: ChatViewProps) {
  return (
    <WorkspaceUpdateProvider isOwner={props.admin.viewer.isOwner}>
      <ChatViewContent {...props} />
    </WorkspaceUpdateProvider>
  );
}

function ChatViewContent({
  workspaceName,
  workspaceIconSeed,
  ownUserId,
  ownName,
  permissions,
  kanbanEnabled = false,
  notesEnabled = false,
  ownAvatarUrl,
  membersFallback,
  roles,
  unreadByChannel,
  admin,
  onSignOut,
}: ChatViewProps) {
  const chat = useChat();
  const { runtime, channels, channelNames, presence, ready, outbox } = chat;
  const voice = useVoice();
  const desktopUpdate = useDesktopUpdates();
  const workspaceUpdate = useWorkspaceUpdates();
  const updateAvailable = desktopUpdate.status?.updateAvailable ?? false;
  const lastChannelKey = `${LAST_CHANNEL_KEY}${workspaceName}`;
  const [activeChannelId, setActiveChannelId] = useState<string | undefined>(
    () => readLocal(lastChannelKey) ?? undefined,
  );
  const [mobilePane, setMobilePane] = useState<"list" | "chat">("list");
  const [mainView, setMainView] = useState<
    "chat" | "threads" | "kanban" | "notes" | "scheduled" | "transcripts"
  >("chat");
  // Bounded retention applies to surfaces and to the Threads inbox: only the
  // view currently on screen stays subscribed. The badge stays cheap through
  // the participation-row count below, so leaving Threads does not need a
  // long-lived inbox query.
  const threadsOpen = mainView === "threads";
  const [adminOpen, setAdminOpen] = useState(false);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [createChannelCategoryId, setCreateChannelCategoryId] = useState<string | undefined>(
    undefined,
  );
  const [createChannelKind, setCreateChannelKind] = useState<"text" | "voice" | undefined>(
    undefined,
  );
  const [createCategoryOpen, setCreateCategoryOpen] = useState(false);
  const [categoryModal, setCategoryModal] = useState<{ category: CategoryView } | null>(null);
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [membersModalChannel, setMembersModalChannel] = useState<ChannelView>();
  const [renameModalChannel, setRenameModalChannel] = useState<ChannelView>();
  const [editChannelModal, setEditChannelModal] = useState<ChannelView>();
  const [editChannelError, setEditChannelError] = useState<string | null>(null);
  const [editChannelBusy, setEditChannelBusy] = useState(false);
  const [threadRoot, setThreadRoot] = useState<MessagePayload>();
  const [pinsOpen, setPinsOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<MessagePayload>();
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);
  const [userSettingsDirty, setUserSettingsDirty] = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);
  /** Bumped on confirmed discard so the retained Notes editor resets its draft. */
  const [notesDiscardToken, setNotesDiscardToken] = useState(0);
  // Surfaces stay mounted after their first visit (see `KeepAlive`), so coming
  // back to Notes or the Kanban board does not re-run its queries behind a
  // spinner. Only the addons the reader has actually opened are mounted, and a
  // hidden surface is released after `HIDDEN_VIEW_TTL_MS` unless an unsaved
  // Notes draft must survive.
  const visitedViews = useVisitedViews(mainView, {
    holdView: notesDirty ? "notes" : undefined,
  });
  const settingsNavigation = useSettingsNavigation(
    true,
    (userSettingsOpen && userSettingsDirty) || notesDirty,
  );
  const navigateFromSettings = settingsNavigation.navigate;
  const [profileTarget, setProfileTarget] = useState<{
    userId: string;
    anchor: HTMLButtonElement;
  } | null>(null);
  const closeProfile = useCallback(() => {
    setProfileTarget(null);
  }, []);
  const [membersOpen, setMembersOpen] = useState(() => readLocal(MEMBERS_OPEN_KEY) === "true");
  const [customStatuses, setCustomStatuses] = useState<ReadonlyMap<string, string>>(new Map());
  const [customStatus, setCustomStatus] = useState<string>(
    () => customStatuses.get(ownUserId) ?? "",
  );
  const [alignment, setAlignment] = useState<"left" | "right">(() =>
    readLocal(MESSAGE_ALIGNMENT_KEY) === "right" ? "right" : "left",
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<readonly ChatSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchArchive, setSearchArchive] = useState<SearchArchiveState>("loading");
  // A search result waiting for its message to load into the open timeline.
  const [pendingJump, setPendingJump] = useState<{
    readonly channelId: string;
    readonly messageId: string;
    readonly opensThread: boolean;
    /** Creation time of a root message; history older than this cannot hold it. */
    readonly createdAt?: number;
  } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const reported = useRef(new Set<string>());
  const attentive = useAttentive();
  const wideShell = useWideShell();
  const surfaceState = { mainView, adminOpen, userSettingsOpen, mobilePane, wideShell } as const;
  // Kept panes stay mounted (see `KeepAlive`), so their effects keep running
  // while another surface is on screen. Anything that acknowledges messages has
  // to ask whether the reader can actually see them.
  const chatCanvasOnScreen = isChatCanvasOnScreen(surfaceState);
  const threadsInboxOnScreen = isThreadsInboxOnScreen(surfaceState);

  // The open channel’s live session. Declared before the member directory
  // because the directory is scoped to the authors and mentions it displays.
  const sessionState = useChannelSession(runtime, activeChannelId, ownUserId);

  // Member data is scoped instead of subscribed wholesale: `members.brief`
  // resolves exactly the people this view renders (timeline authors, the users
  // they mention, DM partners and an open profile), while the member panel
  // pages and the pickers load a bounded roster only while they are open.
  const directoryIds = useMemo(() => {
    const ids = new Set<string>();
    // People whose names are always needed come first, so the cap never trims
    // DM partners or the open profile.
    ids.add(ownUserId);
    for (const entry of channels) {
      if (entry.kind !== "dm" && entry.kind !== "group_dm") {
        continue;
      }
      for (const memberId of entry.memberIds ?? []) {
        ids.add(memberId);
      }
    }
    if (profileTarget !== null) {
      ids.add(profileTarget.userId);
    }
    // Then authors and mentions, newest first: the retained history window can
    // hold more distinct authors than one `members.brief` call resolves.
    for (const message of sessionState.messages.slice().reverse()) {
      ids.add(message.authorId);
      for (const mentioned of message.mentionUserIds) {
        ids.add(mentioned);
      }
    }
    return [...ids].slice(0, MEMBER_DIRECTORY_MAX);
  }, [channels, ownUserId, profileTarget, sessionState.messages]);
  const directoryRows = useQuery(
    api.members.brief,
    directoryIds.length > 0 ? { userIds: directoryIds } : "skip",
  );
  const toEntry = useCallback(
    (member: MemberView) => ({
      userId: member.userId,
      displayName: memberDisplayName(member, member.userId === ownUserId ? ownName : "Member"),
      roleIds: member.roleIds,
      roleNames: roleNamesFor(member, admin.roleViews),
      isOwner: admin.ownerIds.includes(member.userId),
      roleColor: roleColorFor(member, admin.roleViews),
    }),
    [admin.ownerIds, admin.roleViews, ownUserId, ownName],
  );
  const convex = useConvex();
  // Mention autocomplete searches the server instead of filtering a roster the
  // client no longer holds; results merge with the people already on screen.
  const searchMembers = useCallback(
    async (query: string): Promise<readonly MentionTarget[]> => {
      const rows = await convex.query(api.members.search, { query, limit: 8 });
      return rows.map((member) => ({
        userId: member.userId,
        displayName: memberDisplayName(member, "Member"),
        roleIds: member.roleIds,
      }));
    },
    [convex],
  );
  const directory = useMemo(() => {
    const merged = new Map<string, MemberEntry>();
    for (const member of directoryRows ?? []) {
      merged.set(member.userId, toEntry(member));
    }
    // Preview hosts inject their own people; production has none.
    for (const member of membersFallback ?? []) {
      merged.set(member.userId, member);
    }
    return [...merged.values()];
  }, [directoryRows, toEntry, membersFallback]);
  const directoryRoster = useMemo(
    () => (directoryRows ?? []).map((member) => ({ userId: member.userId })),
    [directoryRows],
  );

  // The member panel owns a paged read of the directory.
  const panelPages = useMemberPages(membersOpen, MEMBER_PAGE_INITIAL);
  const panelRows = panelPages.rows;
  const panelHasMore = panelPages.hasMore;
  const loadMoreMembers = panelPages.loadMore;

  // Pickers, the admin surface and the addons need more than the timeline’s
  // people. They load one bounded directory page, and only while open.
  const rosterOpen =
    newConversationOpen ||
    createChannelOpen ||
    membersModalChannel !== undefined ||
    editChannelModal !== undefined ||
    adminOpen ||
    mainView === "kanban" ||
    mainView === "notes" ||
    mainView === "scheduled";
  // Everyone, page by page: an admin must be able to reach every member.
  const rosterPages = useMemberPages(rosterOpen, MEMBER_ROSTER_PAGE, true);
  const rosterRows = rosterPages.rows;
  const roster = useMemo(() => {
    const merged = new Map<string, MemberEntry>();
    for (const entry of directory) {
      merged.set(entry.userId, entry);
    }
    for (const member of rosterRows) {
      if (!merged.has(member.userId)) {
        merged.set(member.userId, toEntry(member));
      }
    }
    return [...merged.values()];
  }, [directory, rosterRows, toEntry]);

  // Avatar URLs for everyone this view can render: the scoped directory, the
  // member panel’s page and any open picker’s roster.
  const avatarRows = useMemo(() => {
    const merged = new Map<string, { userId: string; avatarUrl?: string | null }>();
    for (const list of [directoryRows ?? [], panelRows, rosterRows]) {
      for (const member of list) {
        merged.set(member.userId, member);
      }
    }
    return [...merged.values()];
  }, [directoryRows, panelRows, rosterRows]);

  const createCategory = useMutation(api.categories.create);
  const updateCategory = useMutation(api.categories.update);
  const removeCategory = useMutation(api.categories.remove);
  const reorderCategories = useMutation(api.categories.reorder);
  const setNickname = useMutation(api.members.setNickname);
  const setBio = useMutation(api.members.setBio);
  const generateAvatarUploadUrl = useMutation(api.members.generateAvatarUploadUrl);
  const setAvatar = useMutation(api.members.setAvatar);
  const memberProfile = useQuery(
    api.members.profile,
    profileTarget !== null ? { userId: profileTarget.userId } : "skip",
  );
  const ownProfile = useQuery(
    api.members.profile,
    userSettingsOpen ? { userId: ownUserId } : "skip",
  );
  const profileMember = directory.find((member) => member.userId === profileTarget?.userId);
  const kickMember = useMutation(api.members.kick);
  const banMember = useMutation(api.members.ban);

  // The Threads badge comes from a cheap participation-row count; the inbox
  // itself (root lookups plus opened bodies) is only subscribed while open.
  const threadMentionCount = useQuery(api.messages.threadMentionCount, {}) ?? 0;
  useEffect(() => {
    if (threadsInboxOnScreen)
      void runtime?.client.mutation(api.messages.markThreadMentionsSeen, {}).catch(() => undefined);
  }, [threadsInboxOnScreen, runtime]);
  const publicConfig = useQuery(api.server.publicConfig, {});
  const pagedThreads = publicConfig?.capabilities?.threadInboxPaging === true;
  const legacyThreadRows = useQuery(
    api.messages.threadInbox,
    threadsOpen && !pagedThreads ? { limit: THREAD_INBOX_PAGE } : "skip",
  );
  const threadPages = usePaginatedQuery(
    api.messages.threadInboxPage,
    threadsOpen && pagedThreads ? {} : "skip",
    { initialNumItems: 50 },
  );
  const threadRows = pagedThreads
    ? threadPages.status === "LoadingFirstPage"
      ? undefined
      : threadPages.results
    : legacyThreadRows;
  const notificationPrefs = useQuery(api.notifications.getPrefs, {});
  const notificationPrefsRef = useRef(notificationPrefs);
  notificationPrefsRef.current = notificationPrefs;
  const setNotificationPref = useMutation(api.notifications.setPref);
  const maxUploadBytes = publicConfig?.uploads?.maxBytes ?? DEFAULT_MAX_UPLOAD_BYTES;

  const mutedChannelIds = useMemo(
    () =>
      new Set(channels.filter((channel) => channel.muted === true).map((channel) => channel.id)),
    [channels],
  );
  useDesktopNotifications(runtime, ownUserId, channelNames, mutedChannelIds);
  useWebPush(runtime);
  // The badge sums the summary rows the sidebar already holds, so one message
  // insert no longer triggers a second per-channel tail scan.
  const unreadTotal = useMemo(() => {
    let total = 0;
    for (const row of unreadByChannel.values()) {
      total += row.unreadCount;
    }
    return total;
  }, [unreadByChannel]);
  useUnreadBadge(unreadTotal);

  // The same bounded eager set the provider opens. Channels outside it have no
  // message stream, so their chimes/notifications come from the unread summary.
  const eagerChannelIds = useMemo(
    () => new Set(selectEagerChannelIds(channels, unreadByChannel)),
    [channels, unreadByChannel],
  );
  useUnopenedChannelAlerts({
    suppressionPrefs: notificationPrefs,
    unreadByChannel,
    eagerChannelIds,
    activeChannelId,
    activeChannelVisible: chatCanvasOnScreen,
    mutedChannelIds,
    channelNames,
  });

  // Synthesized cues: a message/mention chime for new messages in channels that
  // are not muted. Background channels notify too, so this mirrors the OS
  // notification path rather than only the open conversation.
  useEffect(() => {
    if (runtime === undefined) {
      return;
    }
    const mountedAt = Date.now();
    const seen = new Set<string>();
    let seeded = false;
    const off = runtime.session.onDecrypted((messages) => {
      if (!seeded) {
        seeded = true;
        for (const message of messages) {
          seen.add(message.id);
        }
        return;
      }
      for (const message of messages) {
        if (
          seen.has(message.id) ||
          message.authorId === ownUserId ||
          message.createdAt < mountedAt
        ) {
          continue;
        }
        seen.add(message.id);
        if (channels.some((entry) => entry.id === message.channelId && entry.muted === true)) {
          continue;
        }
        if (suppressesBroadcast(message, ownUserId, notificationPrefsRef.current)) continue;
        playSound(messageMentionsUser(message, ownUserId) ? "mention" : "message");
      }
    });
    return off;
  }, [runtime, ownUserId, channels]);

  // Ring for an incoming call and raise an OS notification while unfocused.
  const incomingCallId = voice.incoming[0]?.id ?? null;
  const incomingCallChannelId = voice.incoming[0]?.channelId ?? null;
  useEffect(() => {
    if (incomingCallId === null) {
      return;
    }
    const stop = playSound("call-ring");
    if (!document.hasFocus()) {
      const channelName =
        incomingCallChannelId === null ? undefined : channelNames.get(incomingCallChannelId);
      showUnfocusedNotification(
        "Incoming call",
        channelName === undefined ? "Someone is calling" : `Call in #${channelName}`,
      );
    }
    return stop;
  }, [incomingCallId, incomingCallChannelId, channelNames]);

  // Cue when the call connects and as participants come and go.
  const callParticipantCount = voice.call?.participants.length ?? 0;
  const connectedRef = useRef(false);
  const participantCountRef = useRef(0);
  useEffect(() => {
    if (callParticipantCount === 0) {
      connectedRef.current = false;
      participantCountRef.current = 0;
      return;
    }
    if (!connectedRef.current) {
      connectedRef.current = true;
      participantCountRef.current = callParticipantCount;
      playSound("call-connect");
      return;
    }
    const previous = participantCountRef.current;
    participantCountRef.current = callParticipantCount;
    if (callParticipantCount > previous) {
      playSound("call-join");
      if (!document.hasFocus()) {
        showUnfocusedNotification("Someone joined the call", "A participant joined your call.");
      }
    } else if (callParticipantCount < previous) {
      playSound("call-leave");
    }
  }, [callParticipantCount]);

  const typing = useMemo(
    () =>
      createTypingThrottle((channelId) => {
        void runtime?.port.setTyping({ channelId });
      }),
    [runtime],
  );

  // Webhooks are authors but not members, so their names join the lookup
  // here instead of the member list.
  const webhookIdentities = useQuery(api.webhooks.identities, {});
  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const identity of webhookIdentities ?? []) {
      map.set(identity.userId, identity.name);
    }
    for (const member of directory) {
      map.set(member.userId, member.displayName);
    }
    return map;
  }, [directory, webhookIdentities]);

  const memberColors = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of directory) {
      if (
        member.roleColor !== null &&
        member.roleColor !== undefined &&
        member.roleColor.length > 0
      ) {
        map.set(member.userId, member.roleColor);
      }
    }
    return map;
  }, [directory]);

  // Guests are not in the member directory: their name rides on the roster row.
  const guestNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const call of [voice.call, ...voice.activeCalls]) {
      for (const participant of call?.participants ?? []) {
        if (participant.isGuest === true) {
          names.set(participant.userId, participant.displayName ?? "Guest");
        }
      }
    }
    return names;
  }, [voice.call, voice.activeCalls]);
  const callIdentity = useMemo<CallIdentity>(
    () => ({
      nameOf: (id: string) =>
        id === ownUserId ? ownName : (guestNames.get(id) ?? memberNames.get(id) ?? "Member"),
    }),
    [ownUserId, ownName, memberNames, guestNames],
  );

  const presenceByUser = useMemo(
    () => new Map(presence.map((row) => [row.userId, row.status] as const)),
    [presence],
  );
  const presenceOf = useCallback(
    (userId: string): PresenceStatus => presenceByUser.get(userId) ?? "offline",
    [presenceByUser],
  );
  // Counted over the scoped presence set (the people currently on screen), not
  // the whole workspace. For a workspace with more people than the scope cap it
  // is a lower bound; the header labels it as scoped via its title.
  const onlineCount = useMemo(
    () => presence.filter((row) => row.status !== "offline").length,
    [presence],
  );

  const titles = useMemo(() => {
    const map = new Map<string, string>();
    for (const channel of channels) {
      map.set(
        channel.id,
        conversationTitle(channel, ownUserId, (id) => memberNames.get(id)),
      );
    }
    return map;
  }, [channels, ownUserId, memberNames]);

  const mentionNames = useMemo(
    () => [
      ...directory.map((member) => member.displayName),
      ...roles.filter((r) => r.mentionable).map((r) => r.name),
    ],
    [directory, roles],
  );

  const channelMentions = useMemo(
    () =>
      channels
        .filter(
          (entry) =>
            entry.kind !== "dm" &&
            entry.kind !== "group_dm" &&
            !entry.archived &&
            entry.name.length > 0,
        )
        .map((entry) => ({ channelId: entry.id, name: entry.name as string })),
    [channels],
  );
  const categoryMentions = useMemo(
    () =>
      admin.categories.map((entry) => ({
        categoryId: entry.id,
        name: entry.name,
      })),
    [admin.categories],
  );

  // Fall back to the first channel when nothing (or a vanished channel) is selected.
  useEffect(() => {
    if (channels.length === 0) {
      return;
    }
    if (
      activeChannelId === undefined ||
      !channels.some((channel) => channel.id === activeChannelId)
    ) {
      const first = channels.find((channel) => channel.kind === "text") ?? channels[0];
      setActiveChannelId(first?.id);
    }
  }, [channels, activeChannelId]);

  useEffect(() => {
    if (activeChannelId !== undefined) {
      writeLocal(lastChannelKey, activeChannelId);
    }
  }, [activeChannelId, lastChannelKey]);

  useEffect(() => {
    if (runtime === undefined) {
      return;
    }
    const pending = channels
      .filter(
        (channel) =>
          channel.name.length > 0 && !reported.current.has(`${channel.id}:${channel.name}`),
      )
      .map((channel) => ({
        id: channel.id,
        name: channel.name as string,
        key: `${channel.id}:${channel.name}`,
      }));
    if (pending.length === 0) {
      return;
    }
    for (const entry of pending) {
      reported.current.add(entry.key);
    }
    chat.reportChannelNames(pending.map(({ id, name }) => ({ id, name })));
  }, [runtime, channels, chat]);

  useEffect(() => {
    // Build the map once per presence update instead of a `setState` per row,
    // so a scoped refresh of N rows costs one render, not N.
    setCustomStatuses((current) => {
      let next: Map<string, string> | null = null;
      for (const row of presence) {
        if (row.customStatus !== null && row.customStatus.length > 0) {
          if (next === null) {
            next = new Map(current);
          }
          next.set(row.userId, row.customStatus);
        }
      }
      return next ?? current;
    });
  }, [presence]);

  // Seed the settings dialog’s custom status from live presence when it opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed once on open, not on every presence tick
  useEffect(() => {
    if (userSettingsOpen) {
      setCustomStatus(customStatuses.get(ownUserId) ?? "");
    }
  }, [userSettingsOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // The native Cmd+K menu item emits a shell event; open the same palette.
  useEffect(() => {
    const onQuickSwitcher = () => {
      setSearchOpen(true);
    };
    window.addEventListener("aulora:quick-switcher", onQuickSwitcher);
    return () => {
      window.removeEventListener("aulora:quick-switcher", onQuickSwitcher);
    };
  }, []);

  // The native View > Toggle Sidebar menu item hides/shows the channel list.
  // The Threads inbox is reachable only through the sidebar, so hiding it while
  // Threads is open would strand the user; fall back to the chat view instead.
  useEffect(() => {
    const onToggleSidebar = () => {
      setSidebarHidden((hidden) => {
        if (!hidden) {
          setMainView("chat");
        }
        return !hidden;
      });
    };
    window.addEventListener("aulora:toggle-sidebar", onToggleSidebar);
    return () => {
      window.removeEventListener("aulora:toggle-sidebar", onToggleSidebar);
    };
  }, []);

  useEffect(() => {
    if (!searchOpen) {
      setSearchQuery("");
      setSearchResults([]);
      return;
    }
    const trimmed = searchQuery.trim();
    if (trimmed.length === 0) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchArchive("loading");
    let cancelled = false;
    const isCancelled = () => cancelled;
    const timer = setTimeout(() => {
      void (async () => {
        const local = await chat.search(trimmed);
        if (isCancelled()) {
          return;
        }
        setSearchResults(local);
        setSearching(false);
        // Loaded history answers at once; older pages refine the results.
        try {
          for (;;) {
            const complete = (await chat.loadSearchHistory?.()) ?? true;
            if (isCancelled()) {
              return;
            }
            setSearchResults(await chat.search(trimmed));
            if (complete) {
              break;
            }
          }
          setSearchArchive("complete");
        } catch {
          if (!isCancelled()) {
            setSearchArchive("failed");
          }
        }
      })();
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchOpen, searchQuery, chat]);

  useEffect(() => {
    writeLocal(MEMBERS_OPEN_KEY, String(membersOpen));
  }, [membersOpen]);

  const channel = channels.find((entry) => entry.id === activeChannelId);
  // The viewer’s role refs come from the shell’s resolved viewer, so channel
  // permission math no longer needs a member-roster subscription.
  const viewerMember: MemberView | null = {
    id: ownUserId,
    userId: ownUserId,
    nickname: null,
    accountName: null,
    isBot: false,
    roleIds: [...admin.viewer.roleIds],
    joinedAt: 0,
    timeoutUntil: null,
    avatarUrl: ownAvatarUrl,
  };
  const category = admin.categories.find((entry) => entry.id === channel?.categoryId);
  const channelPermissions =
    channel === undefined
      ? permissions
      : resolveViewerPermissions({
          viewer: { userId: ownUserId, isOwner: admin.viewer.isOwner },
          member: viewerMember,
          roles: admin.roleViews,
          categoryOverrides: category?.overrides ?? [],
          channelOverrides: channel.overrides ?? [],
        });
  // Who can actually see the open channel. The panel starts empty until its
  // first page arrives (it no longer holds the whole roster).
  const visibleMemberIds = useQuery(
    api.channels.visibleMemberIds,
    channel !== undefined ? { channelId: channel.id as never } : "skip",
  );
  const visibleMembers = useMemo(() => {
    const page = panelRows;
    const entries = page.map(toEntry);
    if (visibleMemberIds === undefined) {
      return entries;
    }
    // A Set keeps the visibility filter O(page) instead of scanning the
    // visible id list per member.
    const visible = new Set(visibleMemberIds as readonly string[]);
    return entries.filter((member) => visible.has(member.userId));
  }, [panelRows, toEntry, visibleMemberIds]);

  // Presence is fetched only for the people on screen: the open timeline’s
  // authors, the member panel/modal’s displayed members, the sidebar’s DM
  // partners and any open picker. Bounded well under the server’s 300-id cap
  // (see `buildPresenceScope`), so the client never reads the whole table.
  const presenceScope = useMemo(
    () =>
      buildPresenceScope({
        ownUserId,
        timelineAuthorIds: sessionState.messages.map((message) => message.authorId),
        displayedMemberIds: [
          ...(membersOpen ? visibleMembers.map((member) => member.userId) : []),
          ...(membersModalChannel?.memberIds ?? []),
          ...(newConversationOpen && roster.length <= PRESENCE_SCOPE_MAX
            ? roster.map((member) => member.userId)
            : []),
        ],
        channels,
      }),
    [
      ownUserId,
      sessionState.messages,
      membersOpen,
      visibleMembers,
      membersModalChannel,
      newConversationOpen,
      roster,
      channels,
    ],
  );

  useEffect(() => {
    runtime?.setPresenceScope?.(presenceScope);
  }, [runtime, presenceScope]);

  // Roles the members panel can render as their own sections. Members store a
  // role’s stable key when it has one, so match on that ref.
  const memberRoleGroups = useMemo<readonly MembersGroupingRole[]>(
    () =>
      admin.roleViews.map((role) => ({
        id: roleRef(role),
        name: role.name,
        color: role.color,
        position: role.position,
        hoisted: role.hoisted,
        isEveryone: role.isEveryone,
      })),
    [admin.roleViews],
  );

  const channelRoleOptions = useMemo(
    () => roles.map((role) => ({ id: role.roleId, name: role.name })),
    [roles],
  );

  // Mark the newest message read while the reader can actually see it. The
  // canvas is kept mounted when Notes, Kanban, Settings or an admin sheet takes
  // the screen, and marking then would clear a badge for a message nobody read.
  const newest = sessionState.messages.at(-1);
  useEffect(() => {
    if (
      runtime === undefined ||
      activeChannelId === undefined ||
      newest === undefined ||
      !attentive ||
      !chatCanvasOnScreen ||
      !sessionState.readStateLoaded ||
      sessionState.readState?.lastReadMessageId === newest.id
    ) {
      return;
    }
    void runtime.session.markRead(activeChannelId, newest.id).catch(() => undefined);
  }, [
    runtime,
    activeChannelId,
    newest,
    attentive,
    chatCanvasOnScreen,
    sessionState.readStateLoaded,
    sessionState.readState,
  ]);

  const canCreateChannel = hasPermission(permissions, Permission.ManageChannels);
  const canManageChannels =
    admin.viewer.isOwner || hasPermission(permissions, Permission.ManageChannels);
  const manageableRoles = useMemo<readonly ChannelRoleOption[]>(() => {
    const viewer = { isOwner: admin.viewer.isOwner, topPosition: admin.viewer.topPosition };
    const options: ChannelRoleOption[] = [];
    for (const role of admin.roleViews) {
      const option: ChannelRoleOption = {
        id: roleRef(role),
        name: role.name,
        color: role.color,
        position: role.position,
        isEveryone: role.isEveryone,
      };
      if (canEditChannelRole(viewer, option)) {
        options.push(option);
      }
    }
    return options;
  }, [admin.roleViews, admin.viewer.isOwner, admin.viewer.topPosition]);
  const manageableRoleIds = useMemo(
    () => new Set(manageableRoles.map((role) => role.id)),
    [manageableRoles],
  );
  const setChannelOverrides = useMutation(api.channels.setOverrides);
  const canManageCategories =
    admin.viewer.isOwner || hasPermission(permissions, Permission.ManageChannels);
  const canEditNickname =
    admin.viewer.isOwner || hasPermission(permissions, Permission.ChangeOwnNickname);
  const canSend =
    channel === undefined ||
    channel.kind === "dm" ||
    channel.kind === "group_dm" ||
    hasPermission(channelPermissions, Permission.SendMessages);
  const canAttach =
    channel === undefined ||
    channel.kind === "dm" ||
    channel.kind === "group_dm" ||
    hasPermission(channelPermissions, Permission.AttachFiles);
  const canMentionEveryone = canUseMassMentions(channel, undefined, channelPermissions);

  const showAdmin = useMemo(
    () =>
      [
        Permission.ManageRoles,
        Permission.ManageChannels,
        Permission.ManageWorkspace,
        Permission.ViewAuditLog,
        Permission.Kick,
        Permission.Ban,
        Permission.Timeout,
        Permission.ManageNicknames,
      ].some((flag) => hasPermission(permissions, flag)),
    [permissions],
  );

  const mentionMembers: readonly MentionTarget[] = useMemo(
    () =>
      directory.map((member) => ({
        userId: member.userId,
        displayName: member.displayName,
        ...(member.roleIds !== undefined ? { roleIds: member.roleIds } : {}),
      })),
    [directory],
  );

  // `@here`/`@everyone` expand over the open channel’s viewers rather than the
  // whole workspace; the server still filters to actual recipients.
  const memberIds = useMemo(
    () =>
      visibleMemberIds !== undefined
        ? [...(visibleMemberIds as readonly string[])]
        : directoryRoster.map((member) => member.userId),
    [directoryRoster, visibleMemberIds],
  );

  const sidebarUnread = useMemo(() => {
    if (activeChannelId === undefined) {
      return unreadByChannel;
    }
    // The open channel is being read right now; never badge it.
    const map = new Map(unreadByChannel);
    const current = map.get(activeChannelId);
    if (current !== undefined) {
      map.set(activeChannelId, { ...current, unread: false, mentionCount: 0 });
    }
    return map;
  }, [unreadByChannel, activeChannelId]);

  // A mention restores a hidden channel to its category and saved position.
  const restoreTracking = useRef<RestoreTracking>({ restoring: new Set(), baseline: new Map() });
  useEffect(() => {
    restoreMentionedChannels(restoreTracking.current, runtime, channels, unreadByChannel);
  }, [runtime, channels, unreadByChannel]);

  // Queued (and failed) sends for the open channel, rendered optimistically.
  // Thread replies are owned by the thread panel, so only channel roots here.
  const optimisticItems = useMemo(
    () =>
      outbox.filter(
        (item) => item.channelId === activeChannelId && item.threadRootId === undefined,
      ),
    [outbox, activeChannelId],
  );

  const optimisticMessages = useMemo<readonly MessagePayload[]>(
    () =>
      optimisticItems.map((item) => ({
        id: `pending:${item.id}`,
        channelId: item.channelId,
        authorId: ownUserId,
        body: item.text,
        threadRootId: item.threadRootId ?? null,
        attachmentIds: (item.attachments ?? []).map((attachment) => attachment.fileId),
        mentionUserIds: [...item.mentionUserIds],
        mentionEveryone: item.mentionEveryone ?? false,
        mentionHere: item.mentionHere ?? false,
        editedAt: null,
        deletedAt: null,
        pinnedAt: null,
        createdAt: item.createdAt,
      })),
    [optimisticItems, ownUserId],
  );

  const mergedMessages = useMemo(
    () => [...sessionState.messages, ...optimisticMessages],
    [sessionState.messages, optimisticMessages],
  );

  const mergedDecrypted = useMemo(() => {
    const next = new Map(sessionState.decrypted);
    for (const item of optimisticItems) {
      next.set(`pending:${item.id}`, item.text);
    }
    return next;
  }, [sessionState.decrypted, optimisticItems]);

  const replyPreviews = useMemo(() => {
    const map = new Map<
      string,
      {
        authorName: string;
        text: string;
        authorId: string;
        mentionEveryone: boolean;
        mentionHere: boolean;
      }
    >();
    for (const message of mergedMessages) {
      map.set(message.id, {
        authorName:
          message.authorId === ownUserId
            ? ownName
            : (memberNames.get(message.authorId) ?? "Unknown member"),
        text: mergedDecrypted.get(message.id) ?? message.body,
        mentionEveryone: message.mentionEveryone === true,
        mentionHere: message.mentionHere === true,
        authorId: message.authorId,
      });
    }
    return map;
  }, [mergedMessages, mergedDecrypted, ownUserId, ownName, memberNames]);

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
    for (const item of optimisticItems) {
      if (item.attachments !== undefined && item.attachments.length > 0) {
        map.set(`pending:${item.id}`, item.attachments);
      }
    }
    return map;
  }, [runtime, sessionState.messages, optimisticItems]);

  const pendingIds = useMemo(
    () =>
      new Set(
        optimisticItems
          .filter((item) => item.status !== "failed")
          .map((item) => `pending:${item.id}`),
      ),
    [optimisticItems],
  );

  const failureReasons = useMemo(
    () =>
      new Map(
        optimisticItems
          .filter((item) => item.failureReason !== undefined)
          .map((item) => [`pending:${item.id}`, item.failureReason ?? "Not sent"]),
      ),
    [optimisticItems],
  );
  const failedIds = useMemo(
    () =>
      new Set(
        optimisticItems
          .filter((item) => item.status === "failed")
          .map((item) => `pending:${item.id}`),
      ),
    [optimisticItems],
  );

  // Open whichever channel is active, however it became active (a click, the
  // restored last channel, a search hit or a new DM). `openChannel` is
  // idempotent and subscribes the channel’s live message stream.
  const activeSummary = channel;
  const activeChannelKey = activeSummary?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the channel id, not the object identity
  useEffect(() => {
    if (runtime === undefined || activeSummary === undefined) {
      return;
    }
    void chat.openChannel(activeSummary).then(() => {
      if (activeSummary.name.length > 0) {
        chat.reportChannelNames([{ id: activeSummary.id, name: activeSummary.name }]);
      }
    });
  }, [runtime, activeChannelKey]);

  const openChannel = useCallback(
    (channelId: string) => {
      navigateFromSettings(() => {
        setAdminOpen(false);
        setUserSettingsOpen(false);
        setMainView("chat");
        setActiveChannelId(channelId);
        setThreadRoot(undefined);
        setReplyTarget(undefined);
        setMobilePane("chat");
        setSendError(null);
      });
    },
    [navigateFromSettings],
  );

  const startConversation = useCallback(
    async (userIds: readonly string[]) => {
      if (runtime === undefined || userIds.length === 0) {
        return;
      }
      navigateFromSettings(() => {
        void (async () => {
          setNewConversationOpen(false);
          setAdminOpen(false);
          setUserSettingsOpen(false);
          setMainView("chat");
          const channelId = await createConversation(runtime, userIds);
          setActiveChannelId(channelId);
          setThreadRoot(undefined);
          setReplyTarget(undefined);
          setMobilePane("chat");
        })();
      });
    },
    [runtime, navigateFromSettings],
  );

  // A Threads-inbox row opens the existing thread panel for its root message.
  const openThreadFromInbox = useCallback(
    (thread: ThreadInboxItem) => {
      navigateFromSettings(() => {
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
        setMainView("chat");
        setAdminOpen(false);
        setUserSettingsOpen(false);
        setMobilePane("chat");
      });
    },
    [navigateFromSettings],
  );

  const selectSearchHit = useCallback(
    (hit: ChatSearchHit) => {
      setSearchOpen(false);
      openChannel(hit.channelId);
      setPendingJump({
        channelId: hit.channelId,
        messageId: hit.threadRootId ?? hit.messageId,
        opensThread: hit.threadRootId !== undefined,
        ...(hit.threadRootId === undefined ? { createdAt: hit.createdAt } : {}),
      });
    },
    [openChannel],
  );

  // Walk history back until the search result is on screen, then reveal it.
  const {
    messages: loadedMessages,
    loading: historyLoading,
    loadingOlder,
    hasOlder,
    loadOlder,
    historySeamId,
    resetHistoryWindow,
  } = sessionState;
  useEffect(() => {
    if (pendingJump === null) {
      return;
    }
    if (activeChannelId !== pendingJump.channelId) {
      setPendingJump(null);
      return;
    }
    if (historyLoading || loadingOlder) {
      return;
    }
    const target = loadedMessages.find((message) => message.id === pendingJump.messageId);
    if (target === undefined) {
      const oldest = loadedMessages[0];
      const passed =
        pendingJump.createdAt !== undefined &&
        oldest !== undefined &&
        oldest.createdAt < pendingJump.createdAt;
      if (passed && historySeamId !== null) {
        // The retained window was truncated by the page cap and the target sits
        // in the pages evicted between it and the live tail. Re-anchor to the
        // tail so the walk can find it instead of silently giving up.
        resetHistoryWindow();
        return;
      }
      if (hasOlder && !passed) {
        loadOlder();
      } else {
        setPendingJump(null);
      }
      return;
    }
    setPendingJump(null);
    if (pendingJump.opensThread) {
      setThreadRoot(target);
    }
    setTimeout(() => {
      const node = document.getElementById(`message-${target.id}`);
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
      node?.animate(
        [{ backgroundColor: "var(--aulora-accent-soft)" }, { backgroundColor: "transparent" }],
        { duration: 1600, easing: "ease-out" },
      );
    }, 160);
  }, [
    pendingJump,
    activeChannelId,
    loadedMessages,
    historyLoading,
    loadingOlder,
    hasOlder,
    loadOlder,
    historySeamId,
    resetHistoryWindow,
  ]);

  if (!ready || runtime === undefined) {
    return (
      <div className="pane flex flex-1 flex-col items-center justify-center gap-3">
        <Spinner size={28} label="Opening channels" />
        <p className="text-sm text-text-muted">Opening channels…</p>
      </div>
    );
  }

  const title = channel !== undefined ? (titles.get(channel.id) ?? channel.name) : "";
  const placeholder =
    channel === undefined
      ? "Message"
      : channel.kind === "text" || channel.kind === "announcement"
        ? `Message #${title}`
        : `Message ${title}`;

  const sendWithFiles = async (
    targetChannelId: string,
    input: {
      text: string;
      mentionUserIds: readonly string[];
      mentionEveryone?: boolean;
      mentionHere?: boolean;
      mentionChannelIds?: readonly string[];
      mentionCategoryIds?: readonly string[];
      mentionRoleIds?: readonly string[];
      files: readonly File[];
    },
    extra: { threadRootId?: string; replyToId?: string } = {},
  ): Promise<string | undefined> => {
    let attachments: readonly AttachmentDescriptor[] | undefined;
    if (input.files.length > 0) {
      attachments = await uploadFiles(runtime.port, input.files, { maxBytes: maxUploadBytes });
    }
    setSendError(null);
    typing.reset(targetChannelId);
    void runtime.port.clearTyping({ channelId: targetChannelId }).catch(() => undefined);
    const result = await chat.sendMessage(targetChannelId, input.text, {
      mentionUserIds: input.mentionUserIds,
      ...(input.mentionEveryone !== undefined ? { mentionEveryone: input.mentionEveryone } : {}),
      ...(input.mentionHere !== undefined ? { mentionHere: input.mentionHere } : {}),
      ...(input.mentionChannelIds !== undefined
        ? { mentionChannelIds: input.mentionChannelIds }
        : {}),
      ...(input.mentionCategoryIds !== undefined
        ? { mentionCategoryIds: input.mentionCategoryIds }
        : {}),
      ...(input.mentionRoleIds !== undefined ? { mentionRoleIds: input.mentionRoleIds } : {}),
      ...(extra.threadRootId !== undefined ? { threadRootId: extra.threadRootId } : {}),
      ...(extra.replyToId !== undefined ? { replyToId: extra.replyToId } : {}),
      ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
    });
    if (result.error !== undefined) {
      throw new Error(result.error);
    }
    return result.queued ? undefined : result.messageId;
  };

  const closeCategoryModal = () => {
    setCreateCategoryOpen(false);
    setCategoryModal(null);
    setCategoryError(null);
    setCategoryBusy(false);
  };

  const submitCategory = async (name: string) => {
    setCategoryBusy(true);
    setCategoryError(null);
    try {
      if (categoryModal !== null) {
        await updateCategory({ categoryId: categoryModal.category.id as never, name });
      } else {
        await createCategory({ name });
      }
      closeCategoryModal();
    } catch (error) {
      setCategoryError(errorMessage(error));
    } finally {
      setCategoryBusy(false);
    }
  };

  const saveUserSettings = async (input: {
    alignment: "left" | "right";
    nickname?: string;
    bio?: string;
  }) => {
    writeLocal(MESSAGE_ALIGNMENT_KEY, input.alignment);
    setAlignment(input.alignment);
    if (input.nickname !== undefined) {
      await setNickname({ userId: ownUserId, nickname: input.nickname });
    }
    if (input.bio !== undefined) {
      await setBio({ bio: input.bio });
    }
    setUserSettingsOpen(false);
  };

  const changeAvatar = async (file: File) => {
    const url = await generateAvatarUploadUrl({});
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!response.ok) {
      throw new Error("Avatar upload failed");
    }
    const body = (await response.json()) as { storageId?: unknown };
    if (typeof body.storageId !== "string") {
      throw new Error("Avatar upload did not return a storage id");
    }
    await setAvatar({ storageId: body.storageId as never });
  };

  const showList = mobilePane === "list" || (mainView === "chat" && channel === undefined);
  const adminView = adminOpen && showAdmin;
  const kanbanAllowed = kanbanEnabled && hasPermission(permissions, Permission.ViewKanban);
  const notesAllowed = notesEnabled && hasPermission(permissions, Permission.ViewNotes);
  const scheduledAllowed = canViewScheduledCalls(permissions, voice.addons.scheduledCalls);
  const transcriptsAllowed = canViewTranscripts(permissions, voice.addons.transcription);
  // Every surface except the chat canvas stays mounted after its first visit
  // (see `KeepAlive`); these flags decide which one is actually on screen.
  const surfaceAvailable = !adminView && !userSettingsOpen;
  const kanbanVisible = surfaceAvailable && mainView === "kanban" && kanbanAllowed;
  const notesVisible = surfaceAvailable && mainView === "notes" && notesAllowed;
  const scheduledVisible = surfaceAvailable && mainView === "scheduled" && scheduledAllowed;
  const transcriptsVisible = surfaceAvailable && mainView === "transcripts" && transcriptsAllowed;
  const chatVisible =
    surfaceAvailable && !kanbanVisible && !notesVisible && !scheduledVisible && !transcriptsVisible;
  const rightPanel =
    threadRoot !== undefined && channel !== undefined ? "thread" : membersOpen ? "members" : null;
  const callTitle =
    voice.call !== null
      ? ((voice.call.channelId !== null ? titles.get(voice.call.channelId) : undefined) ??
        (voice.call.channelId === null ? voice.scheduledTitle?.title : undefined) ??
        channel?.name ??
        "")
      : "";
  const incomingCall = voice.incoming[0];
  // Shareable links need the workspace origin, which `ProfileProvider` records
  // after mount. Until then the sharing actions are hidden rather than building
  // a bare path that looks like a link.
  const shareableOrigin = publicOriginOrNull();

  const submitChannelEdit = async (patch: EditChannelPatch) => {
    const target = editChannelModal;
    if (target === undefined) {
      return;
    }
    setEditChannelBusy(true);
    setEditChannelError(null);
    try {
      const submittedRoles = patch.roleOverrides.filter((override) =>
        manageableRoleIds.has(override.targetId),
      );
      const currentRoles = roleOverridesFor(target.overrides ?? []).filter((override) =>
        manageableRoleIds.has(override.targetId),
      );
      if (!sameOverrides(submittedRoles, currentRoles)) {
        await setChannelOverrides({
          channelId: target.id as never,
          overrides: mergeRoleOverrides(
            target.overrides ?? [],
            submittedRoles,
            manageableRoleIds,
          ).map((override) => ({
            targetId: override.targetId,
            targetType: override.targetType,
            allow: override.allow,
            deny: override.deny,
          })),
        });
      }
      await commitChannelEdit(runtime, {
        baseline: channelEditBaseline(target, titles.get(target.id) ?? target.name),
        name: patch.name,
        topic: patch.topic,
        isPrivate: patch.private,
        memberIds: patch.memberIds,
        blockedUserIds: patch.blockedUserIds,
        ownUserId,
      });
      setEditChannelModal(undefined);
    } catch (error) {
      setEditChannelError(errorMessage(error));
    } finally {
      setEditChannelBusy(false);
    }
  };

  return (
    <MemberAvatarProvider members={avatarRows}>
      <ConfirmDialog
        open={settingsNavigation.pending !== null}
        title="Discard unsaved changes?"
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onClose={settingsNavigation.cancel}
        onConfirm={() => {
          setUserSettingsDirty(false);
          // The retained Notes view owns its draft: reset it explicitly and let
          // it report clean, rather than clearing this guard while the child
          // still renders discarded text.
          setNotesDiscardToken((token) => token + 1);
          settingsNavigation.discard();
        }}
      />
      <div className="relative flex min-h-0 min-w-0 flex-1">
        {!sidebarHidden && (
          <div className={cn("min-h-0 w-full md:flex md:w-auto", showList ? "flex" : "hidden")}>
            <ChannelSidebar
              workspaceName={workspaceName}
              workspaceIconSeed={workspaceIconSeed}
              ownUserId={ownUserId}
              ownName={ownName}
              ownStatus={presenceOf(ownUserId)}
              onlineCount={onlineCount}
              channels={channels}
              categories={admin.categories}
              titles={titles}
              presenceOf={presenceOf}
              memberNameOf={(id) =>
                id === ownUserId ? ownName : (memberNames.get(id) ?? "Member")
              }
              activeChannelId={activeChannelId}
              unreadByChannel={sidebarUnread}
              canCreateChannel={canCreateChannel}
              mainView={mainView}
              {...(kanbanEnabled && hasPermission(permissions, Permission.ViewKanban)
                ? {
                    onOpenKanban: () => {
                      navigateFromSettings(() => {
                        setMainView("kanban");
                        setMobilePane("chat");
                        setThreadRoot(undefined);
                        setAdminOpen(false);
                        setUserSettingsOpen(false);
                      });
                    },
                  }
                : {})}
              {...(notesEnabled && hasPermission(permissions, Permission.ViewNotes)
                ? {
                    onOpenNotes: () => {
                      navigateFromSettings(() => {
                        setMainView("notes");
                        setMobilePane("chat");
                        setThreadRoot(undefined);
                        setAdminOpen(false);
                        setUserSettingsOpen(false);
                      });
                    },
                  }
                : {})}
              {...(canViewScheduledCalls(permissions, voice.addons.scheduledCalls)
                ? {
                    onOpenScheduled: () => {
                      navigateFromSettings(() => {
                        setMainView("scheduled");
                        setMobilePane("chat");
                        setThreadRoot(undefined);
                        setAdminOpen(false);
                        setUserSettingsOpen(false);
                      });
                    },
                  }
                : {})}
              {...(canViewTranscripts(permissions, voice.addons.transcription)
                ? {
                    onOpenTranscripts: () => {
                      navigateFromSettings(() => {
                        setMainView("transcripts");
                        setMobilePane("chat");
                        setThreadRoot(undefined);
                        setAdminOpen(false);
                        setUserSettingsOpen(false);
                      });
                    },
                  }
                : {})}
              threadMentionCount={threadMentionCount}
              onOpenThreads={() => {
                navigateFromSettings(() => {
                  setMainView("threads");
                  setThreadRoot(undefined);
                  setAdminOpen(false);
                  setUserSettingsOpen(false);
                });
              }}
              onCreateCategory={() => {
                setCreateCategoryOpen(true);
              }}
              canManageCategories={canManageCategories}
              appUpdateAvailable={desktopUpdate.status?.updateAvailable ?? false}
              workspaceUpdateAvailable={workspaceUpdate.available}
              onOpenUserSettings={() => {
                navigateFromSettings(() => {
                  setAdminOpen(false);
                  setUserSettingsOpen(true);
                });
              }}
              showAdmin={showAdmin}
              onOpenAdmin={() => {
                navigateFromSettings(() => {
                  setUserSettingsOpen(false);
                  setAdminOpen(true);
                });
              }}
              workspaceSwitcher={<WorkspaceMenu onlineCount={onlineCount} variant="header" />}
              onSelect={(channelId) => {
                openChannel(channelId);
              }}
              onCreateChannel={(kind) => {
                setCreateChannelKind(kind);
                setCreateChannelCategoryId(undefined);
                setCreateChannelOpen(true);
              }}
              categoryActions={{
                rename: (category) => {
                  setCategoryModal({ category });
                },
                delete: (category) => void removeCategory({ categoryId: category.id as never }),
                createChannel: (category) => {
                  setCreateChannelKind("text");
                  setCreateChannelCategoryId(category.id);
                  setCreateChannelOpen(true);
                },
              }}
              channelActions={{
                open: (channel) => {
                  openChannel(channel.id);
                },
                invite: (channel) => {
                  setMembersModalChannel(channel);
                },
                ...(admin.viewer.isOwner || hasPermission(permissions, Permission.ManageChannels)
                  ? {
                      rename: (channel: ChannelView) => {
                        setRenameModalChannel(channel);
                      },
                    }
                  : {}),
                ...(canManageChannels
                  ? {
                      edit: (channel: ChannelView) => {
                        if (channel.kind === "dm" || channel.kind === "group_dm") {
                          return;
                        }
                        setEditChannelError(null);
                        setEditChannelModal(channel);
                      },
                    }
                  : {}),
                markRead: (channel) => {
                  const newestId = channel.id === activeChannelId ? newest?.id : undefined;
                  if (newestId !== undefined) {
                    void runtime.session.markRead(channel.id, newestId).catch(() => undefined);
                  }
                },
                ...(shareableOrigin === null
                  ? {}
                  : {
                      copyLink: (channel: ChannelView) => {
                        const url = publicUrl(`/?channel=${channel.id}`);
                        if (url !== null) {
                          void navigator.clipboard.writeText(url).catch(() => undefined);
                        }
                      },
                    }),
                hide: (channel) => {
                  restoreTracking.current.baseline.set(
                    channel.id,
                    unreadByChannel.get(channel.id)?.mentionCount ?? 0,
                  );
                  void runtime.port
                    .setChannelHidden?.({ channelId: channel.id, hidden: true })
                    .catch(() => undefined);
                },
                unhide: (channel) => {
                  void runtime.port
                    .setChannelHidden?.({ channelId: channel.id, hidden: false })
                    .catch(() => undefined);
                },
                mute: (channel) => {
                  void runtime.port
                    .setChannelMuted?.({ channelId: channel.id, muted: true })
                    .catch(() => undefined);
                },
                unmute: (channel) => {
                  void runtime.port
                    .setChannelMuted?.({ channelId: channel.id, muted: false })
                    .catch(() => undefined);
                },
                pin: (channel) => {
                  void runtime.port
                    .setChannelPinned?.({ channelId: channel.id, pinned: true })
                    .catch(() => undefined);
                },
                unpin: (channel) => {
                  void runtime.port
                    .setChannelPinned?.({ channelId: channel.id, pinned: false })
                    .catch(() => undefined);
                },
                ...(admin.viewer.isOwner || hasPermission(permissions, Permission.ManageChannels)
                  ? {
                      archive: (channel: ChannelView) => {
                        void archiveChannel(runtime, channel.id);
                      },
                    }
                  : {}),
              }}
              onNewConversation={() => {
                setNewConversationOpen(true);
              }}
              onOpenSearch={() => {
                setSearchOpen(true);
              }}
              onSetStatus={(status) => {
                void runtime.port.setStatus({ status });
              }}
              customStatus={customStatus}
              onSetCustomStatus={(text) => {
                setCustomStatus(text);
                setCustomStatuses((current) => {
                  const next = new Map(current);
                  if (text.length > 0) {
                    next.set(ownUserId, text);
                  } else {
                    next.delete(ownUserId);
                  }
                  return next;
                });
                void runtime.port.setStatus({ status: presenceOf(ownUserId), customStatus: text });
              }}
              canReorderChannels={
                admin.viewer.isOwner || hasPermission(permissions, Permission.ManageChannels)
              }
              onReorderChannels={(moves) =>
                void runtime.port.reorderChannels({ moves }).catch(() => undefined)
              }
              canReorderCategories={canManageCategories}
              onReorderCategories={(moves) =>
                void reorderCategories({
                  moves: moves.map((move) => ({
                    categoryId: move.categoryId as never,
                    position: move.position,
                  })),
                }).catch(() => undefined)
              }
              onSignOut={onSignOut}
            />
          </div>
        )}

        {(kanbanVisible || visitedViews.has("kanban")) && kanbanAllowed && (
          <KeepAlive active={kanbanVisible}>
            <Suspense fallback={<SurfaceFallback />}>
              <KanbanView
                ownUserId={ownUserId}
                permissions={permissions}
                members={roster}
                onBack={() => {
                  setMainView("chat");
                  setMobilePane("list");
                }}
              />
            </Suspense>
          </KeepAlive>
        )}
        {(notesVisible || visitedViews.has("notes")) && notesAllowed && (
          <KeepAlive active={notesVisible}>
            <Suspense fallback={<SurfaceFallback />}>
              <NotesView
                discardToken={notesDiscardToken}
                onDirtyChange={setNotesDirty}
                ownUserId={ownUserId}
                permissions={permissions}
                members={roster}
                onBack={() => {
                  setMainView("chat");
                  setMobilePane("list");
                }}
              />
            </Suspense>
          </KeepAlive>
        )}
        {(scheduledVisible || visitedViews.has("scheduled")) && scheduledAllowed && (
          <KeepAlive active={scheduledVisible}>
            <Suspense fallback={<SurfaceFallback />}>
              <ScheduledCallsView
                ownUserId={ownUserId}
                permissions={permissions}
                members={roster}
                roles={admin.roleViews}
                channels={channels}
                titles={titles}
                guestCallsEnabled={voice.addons.guestCalls}
                onBack={() => {
                  setMainView("chat");
                  setMobilePane("list");
                }}
              />
            </Suspense>
          </KeepAlive>
        )}
        {(transcriptsVisible || visitedViews.has("transcripts")) && transcriptsAllowed && (
          <KeepAlive active={transcriptsVisible}>
            <Suspense fallback={<SurfaceFallback />}>
              <TranscriptsView
                permissions={permissions}
                titles={titles}
                onBack={() => {
                  setMainView("chat");
                  setMobilePane("list");
                }}
              />
            </Suspense>
          </KeepAlive>
        )}
        <KeepAlive active={chatVisible}>
          <section
            className={cn(
              "pane chat-canvas relative min-h-0 min-w-0 flex-1 flex-col",
              showList ? "hidden md:flex" : "flex",
            )}
            aria-label={mainView === "threads" ? "Threads inbox" : "Conversation"}
          >
            {mainView === "threads" ? (
              <ThreadsInbox
                threads={threadRows ?? []}
                loading={threadRows === undefined}
                {...(pagedThreads && threadPages.status === "CanLoadMore"
                  ? { onLoadMore: () => threadPages.loadMore(50) }
                  : {})}
                channelNames={channelNames}
                memberNames={memberNames}
                titles={titles}
                ownUserId={ownUserId}
                onOpen={openThreadFromInbox}
              />
            ) : channel === undefined ? (
              <EmptyState
                className="px-8"
                title={channels.length === 0 ? "No conversations yet" : "Pick a conversation"}
                {...(channels.length === 0
                  ? {
                      description: canCreateChannel
                        ? "Create a channel from the sidebar, or start a direct message."
                        : "Start a direct message, or ask an admin to add you to a channel.",
                    }
                  : {})}
              />
            ) : channel.kind === "voice" ? (
              <Suspense fallback={<SurfaceFallback />}>
                <VoiceChannelView channel={channel} title={title} identity={callIdentity} />
              </Suspense>
            ) : (
              <ChannelPane
                mentionMarkers={resolveServerCapabilities(publicConfig).mentionMarkers}
                runtime={runtime}
                channel={channel}
                title={title}
                placeholder={placeholder}
                ownUserId={ownUserId}
                ownName={ownName}
                alignment={alignment}
                channelPermissions={channelPermissions}
                sessionState={sessionState}
                mergedMessages={mergedMessages}
                mergedDecrypted={mergedDecrypted}
                attachments={attachmentsByMessage}
                pendingIds={pendingIds}
                failureReasons={failureReasons}
                failedIds={failedIds}
                replyPreviews={replyPreviews}
                memberNames={memberNames}
                memberColors={memberColors}
                mentionNames={mentionNames}
                mentionMembers={mentionMembers}
                searchMembers={searchMembers}
                memberIds={memberIds}
                roles={roles}
                channelMentions={channelMentions}
                categoryMentions={categoryMentions}
                visibleMemberCount={visibleMembers.length}
                presenceOf={presenceOf}
                voice={voice}
                chat={chat}
                canSend={canSend}
                canAttach={canAttach}
                canMentionEveryone={canMentionEveryone}
                maxUploadBytes={maxUploadBytes}
                pinsOpen={pinsOpen}
                membersOpen={rightPanel === "members"}
                {...(replyTarget !== undefined ? { replyTarget } : {})}
                sendError={sendError}
                typingPing={(channelId) => {
                  typing.ping(channelId);
                }}
                onOpenChannel={openChannel}
                onSetReplyTarget={setReplyTarget}
                onSetThreadRoot={setThreadRoot}
                onToggleMembers={() => {
                  setThreadRoot(undefined);
                  setMembersOpen((open) => (threadRoot !== undefined ? true : !open));
                }}
                onOpenSearch={() => {
                  setSearchOpen(true);
                }}
                onTogglePins={() => {
                  setPinsOpen((open) => !open);
                }}
                onBack={() => {
                  setMobilePane("list");
                }}
                onSetSendError={setSendError}
                onSetNewConversationOpen={setNewConversationOpen}
                sendWithFiles={sendWithFiles}
              />
            )}
          </section>
        </KeepAlive>
        {adminView && (
          <Suspense fallback={<SurfaceFallback />}>
            <AdminPanel
              viewer={admin.viewer}
              ownerIds={admin.ownerIds}
              ownerManagementAvailable={admin.ownerManagementAvailable}
              roles={admin.roleViews}
              members={rosterRows.length > 0 ? rosterRows : EMPTY_MEMBERS}
              categories={admin.categories}
              channels={channels}
              channelNames={channelNames}
              origin={shareableOrigin}
              onClose={() => {
                setAdminOpen(false);
              }}
            />
          </Suspense>
        )}
        {!adminView && userSettingsOpen && (
          <UserSettingsView
            ownUserId={ownUserId}
            ownName={ownName}
            onDirtyChange={setUserSettingsDirty}
            ownBio={ownProfile?.bio ?? ""}
            busy={ownProfile === undefined}
            alignment={alignment}
            canEditNickname={canEditNickname}
            isOwner={admin.viewer.isOwner}
            onSave={saveUserSettings}
            hasAvatar={ownAvatarUrl !== null}
            onChangeAvatar={changeAvatar}
            onClearAvatar={async () => {
              await setAvatar({});
            }}
            onBack={() => {
              setUserSettingsOpen(false);
            }}
            onSignOut={onSignOut}
            voiceSettings={<DeviceSettingsSection />}
            soundSettings={
              <NotificationsSettingsSection
                prefsLoaded={notificationPrefs !== undefined}
                suppressMassMentions={
                  notificationPrefs?.find((row) => row.scope === "server")?.suppressMassMentions ===
                  true
                }
                {...(resolveServerCapabilities(publicConfig).mentionMarkers
                  ? {
                      onSuppressMassMentions: (value: boolean) => {
                        void setNotificationPref({
                          scope: "server",
                          suppressMassMentions: value,
                        }).catch((error) => {
                          setSendError(errorMessage(error));
                        });
                      },
                    }
                  : {})}
              />
            }
            {...(isDesktop() ? { updateSettings: <DesktopUpdateSettings /> } : {})}
            updateAvailable={updateAvailable}
          />
        )}

        {rightPanel !== null &&
          channel !== undefined &&
          !adminView &&
          mainView !== "kanban" &&
          mainView !== "notes" &&
          mainView !== "scheduled" &&
          mainView !== "transcripts" &&
          !userSettingsOpen &&
          mainView === "chat" && (
            <div className="fixed inset-y-2.5 right-2.5 z-30 flex lg:static lg:z-auto">
              {rightPanel === "thread" && threadRoot !== undefined ? (
                <ThreadsPanel
                  channelKind={channel.kind}
                  mentionMarkers={resolveServerCapabilities(publicConfig).mentionMarkers}
                  key={threadRoot.id}
                  runtime={runtime}
                  channelId={channel.id}
                  channelTitle={
                    channel.kind === "text" || channel.kind === "announcement" ? `#${title}` : title
                  }
                  root={
                    loadedMessages.find((message) => message.id === threadRoot.id) ?? threadRoot
                  }
                  rootText={sessionState.decrypted.get(threadRoot.id)}
                  members={mentionMembers}
                  roles={roles}
                  memberIds={memberIds}
                  permissions={channelPermissions}
                  maxUploadBytes={maxUploadBytes}
                  ownUserId={ownUserId}
                  ownName={ownName}
                  memberNames={memberNames}
                  memberColors={memberColors}
                  mentionNames={mentionNames}
                  onClose={() => {
                    setThreadRoot(undefined);
                  }}
                  onTyping={(channelId) => {
                    typing.ping(channelId);
                  }}
                  onSendReply={async ({ alsoSendToChannel, ...input }) => {
                    await sendThreadReply(
                      () =>
                        sendWithFiles(channel.id, input, {
                          threadRootId: threadRoot.id,
                        }),
                      alsoSendToChannel
                        ? () =>
                            sendWithFiles(channel.id, {
                              ...input,
                              files: [],
                              mentionEveryone:
                                canMentionEveryone && hasBroadcastToken(input.text, "everyone"),
                              mentionHere:
                                canMentionEveryone && hasBroadcastToken(input.text, "here"),
                            })
                        : undefined,
                      (error) => {
                        setSendError(errorMessage(error));
                      },
                    );
                  }}
                  onEdit={(message, text) => {
                    void runtime.session.editMessage(channel.id, message.id, text);
                  }}
                  onDelete={(message) => {
                    void runtime.session.deleteMessage(channel.id, message.id);
                    if (message.id === threadRoot.id) {
                      setThreadRoot(undefined);
                    }
                  }}
                  onPinToggle={(message) => {
                    void (message.pinnedAt !== null
                      ? runtime.session.unpinMessage(channel.id, message.id)
                      : runtime.session.pinMessage(channel.id, message.id));
                  }}
                  onReact={(message, emoji) => {
                    void runtime.session.toggleReaction(channel.id, message.id, emoji);
                  }}
                />
              ) : (
                <MembersPanel
                  members={visibleMembers}
                  hasMore={panelHasMore}
                  onLoadMore={loadMoreMembers}
                  presence={presence}
                  roles={memberRoleGroups}
                  customStatuses={customStatuses}
                  ownUserId={ownUserId}
                  onViewProfile={(userId, anchor) => {
                    setProfileTarget((current) =>
                      current?.userId === userId ? null : { userId, anchor },
                    );
                  }}
                  onMessage={(userId) => void startConversation([userId])}
                  onClose={() => {
                    setMembersOpen(false);
                  }}
                  memberActions={{
                    message: (userId) => {
                      void startConversation([userId]);
                    },
                    ...(hasPermission(permissions, Permission.ManageRoles)
                      ? {
                          assignRoles: () => {
                            setAdminOpen(true);
                          },
                        }
                      : {}),
                    ...(hasPermission(permissions, Permission.Kick)
                      ? {
                          kick: (userId: string) => {
                            void kickMember({ userId });
                          },
                        }
                      : {}),
                    ...(hasPermission(permissions, Permission.Ban)
                      ? {
                          ban: (userId: string) => {
                            void banMember({ userId });
                          },
                        }
                      : {}),
                  }}
                />
              )}
            </div>
          )}

        {profileMember !== undefined && profileTarget !== null && rightPanel === "members" && (
          <MemberProfilePopover
            key={profileMember.userId}
            member={profileMember}
            anchor={profileTarget.anchor}
            status={presenceOf(profileMember.userId)}
            profile={memberProfile}
            onMessage={(userId) => startConversation([userId])}
            onClose={closeProfile}
          />
        )}

        {incomingCall !== undefined && (
          <IncomingCallModal
            call={incomingCall}
            title={
              (incomingCall.channelId !== null ? titles.get(incomingCall.channelId) : undefined) ??
              ""
            }
            identity={callIdentity}
          />
        )}

        {voice.error !== null && (
          <div
            role="alert"
            className="fixed bottom-4 left-1/2 z-[75] flex -translate-x-1/2 items-center gap-3 rounded-[10px] border border-danger/30 bg-surface-2 px-4 py-2.5 text-[13px] text-text shadow-2xl shadow-black/30"
          >
            <Icon name="phone-off" size={16} className="shrink-0 text-danger" />
            <span className="max-w-[420px]">{voice.error}</span>
            <button
              type="button"
              aria-label="Dismiss call error"
              onClick={() => {
                voice.clearError();
              }}
              className="shrink-0 text-text-muted transition hover:text-text"
            >
              <Icon name="x" size={15} />
            </button>
          </div>
        )}

        {!(channel?.kind === "voice" && voice.call?.channelId === channel.id) && (
          <Suspense fallback={null}>
            <CallDock title={callTitle} identity={callIdentity} />
          </Suspense>
        )}
        {voice.view === "stage" && (
          <Suspense fallback={null}>
            <CallStage title={callTitle} identity={callIdentity} />
          </Suspense>
        )}
        <CallPictureInPicture title={callTitle} identity={callIdentity} />
        {voice.call !== null && voice.addons.guestCalls && (
          <Suspense fallback={null}>
            <GuestLobbyPrompt />
          </Suspense>
        )}
        {voice.inviteGuestOpen && voice.call !== null && (
          <Suspense fallback={null}>
            <InviteGuestDialog />
          </Suspense>
        )}

        {searchOpen && (
          <SearchPanel
            query={searchQuery}
            results={searchResults}
            searching={searching}
            archive={searchArchive}
            conversations={channels}
            titles={titles}
            ownUserId={ownUserId}
            memberNames={memberNames}
            onQueryChange={setSearchQuery}
            onSelectConversation={(channelId) => {
              setSearchOpen(false);
              openChannel(channelId);
            }}
            onSelect={selectSearchHit}
            onClose={() => {
              setSearchOpen(false);
            }}
          />
        )}

        {newConversationOpen && (
          <NewConversationDialog
            members={roster}
            ownUserId={ownUserId}
            presenceOf={presenceOf}
            onStart={(userIds) => void startConversation(userIds)}
            onClose={() => {
              setNewConversationOpen(false);
            }}
          />
        )}

        <CreateChannelModal
          open={createChannelOpen}
          {...(createChannelCategoryId !== undefined
            ? { initialCategoryId: createChannelCategoryId }
            : {})}
          {...(createChannelKind !== undefined ? { initialKind: createChannelKind } : {})}
          members={roster}
          roles={channelRoleOptions}
          onClose={() => {
            setCreateChannelOpen(false);
            setCreateChannelCategoryId(undefined);
            setCreateChannelKind(undefined);
          }}
          onCreate={async (input: CreateChannelInput) => {
            setCreateChannelOpen(false);
            setCreateChannelCategoryId(undefined);
            setCreateChannelKind(undefined);
            const channelId = await createChannel(runtime, input);
            if (channelId !== undefined) {
              setActiveChannelId(channelId);
              setMobilePane("chat");
            }
          }}
        />

        <CreateCategoryModal
          open={createCategoryOpen || categoryModal !== null}
          mode={categoryModal !== null ? "rename" : "create"}
          {...(categoryModal !== null
            ? { initialName: categoryModal.category.name, title: "Rename category" }
            : {})}
          busy={categoryBusy}
          error={categoryError}
          onClose={closeCategoryModal}
          onSubmit={submitCategory}
        />

        {renameModalChannel !== undefined && (
          <RenameChannelModal
            open
            currentName={titles.get(renameModalChannel.id) ?? renameModalChannel.name}
            kindLabel={
              renameModalChannel.kind === "announcement" ? "announcement channel" : "channel"
            }
            onClose={() => {
              setRenameModalChannel(undefined);
            }}
            onRename={async (name) => {
              setRenameModalChannel(undefined);
              await runtime.session.setChannelName(renameModalChannel.id, name);
            }}
          />
        )}

        {membersModalChannel !== undefined && (
          <ChannelMembersModal
            open
            channelName={titles.get(membersModalChannel.id) ?? membersModalChannel.name}
            isPrivate={membersModalChannel.isPrivate === true}
            members={roster}
            {...(membersModalChannel.memberIds !== undefined
              ? { memberIds: membersModalChannel.memberIds }
              : {})}
            ownUserId={ownUserId}
            presenceOf={presenceOf}
            canManage={
              admin.viewer.isOwner || hasPermission(permissions, Permission.ManageChannels)
            }
            onAdd={(userId) => {
              void runtime.port
                .addChannelMember({ channelId: membersModalChannel.id, userId })
                .catch(() => undefined);
            }}
            onRemove={(userId) => {
              void runtime.port
                .removeChannelMember({ channelId: membersModalChannel.id, userId })
                .catch(() => undefined);
            }}
            onClose={() => {
              setMembersModalChannel(undefined);
            }}
          />
        )}

        {editChannelModal !== undefined && (
          <EditChannelModal
            open
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
            roles={manageableRoles}
            initialRoleOverrides={roleOverridesFor(editChannelModal.overrides ?? []).filter(
              (override) => manageableRoleIds.has(override.targetId),
            )}
            canManageRoleOverrides={canManageChannels && manageableRoles.length > 0}
            ownUserId={ownUserId}
            members={roster}
            busy={editChannelBusy}
            error={editChannelError}
            onClose={() => {
              setEditChannelModal(undefined);
              setEditChannelError(null);
            }}
            onSave={submitChannelEdit}
          />
        )}
      </div>
    </MemberAvatarProvider>
  );
}

/**
 * Creates a channel and opens its session; the server stores the plaintext name
 * sealed at rest.
 */
async function createChannel(
  runtime: NonNullable<ReturnType<typeof useChat>["runtime"]>,
  input: CreateChannelInput,
): Promise<string | undefined> {
  const channelId = await runtime.port.createChannel({
    kind: input.kind,
    name: input.name,
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
    ...(input.private ? { private: true } : {}),
    ...(input.private && input.memberIds !== undefined && input.memberIds.length > 0
      ? { memberIds: input.memberIds }
      : {}),
    ...(input.private && input.roleIds !== undefined && input.roleIds.length > 0
      ? { roleIds: input.roleIds }
      : {}),
  });
  await runtime.session.openChannel({
    id: channelId,
    kind: input.kind,
    categoryId: input.categoryId ?? null,
    name: input.name,
    topic: null,
    archived: false,
    ...(input.private ? { isPrivate: true } : {}),
  });
  return channelId;
}

/** Archives a channel (owner or ManageChannels only). */
async function archiveChannel(
  runtime: NonNullable<ReturnType<typeof useChat>["runtime"]>,
  channelId: string,
): Promise<void> {
  await runtime.port.archiveChannel({ channelId });
}

/**
 * Opens (or reuses) a DM with one person, or a group DM with several. The
 * server dedupes by participants.
 */
async function createConversation(
  runtime: NonNullable<ReturnType<typeof useChat>["runtime"]>,
  userIds: readonly string[],
): Promise<string> {
  const group = userIds.length > 1;
  const { channelId, created } = group
    ? await runtime.port.createGroupDm({ memberIds: userIds })
    : await runtime.port.createDm({ otherUserId: userIds[0] as string });
  if (!created) {
    return channelId;
  }
  await runtime.session.openChannel({
    id: channelId,
    kind: group ? "group_dm" : "dm",
    categoryId: null,
    name: null,
    topic: null,
    archived: false,
  });
  return channelId;
}

export { Permission };
