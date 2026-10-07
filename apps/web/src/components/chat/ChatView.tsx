import {
  type AttachmentDescriptor,
  type ChannelView,
  conversationTitle,
  createTypingThrottle,
  hasPermission,
  type MentionTarget,
  type MessagePayload,
  Permission,
  type RoleMentionTarget,
} from "@aulora/core";
import { cn, Icon, Spinner } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import {
  attachmentUploadErrorMessage,
  DEFAULT_MAX_UPLOAD_BYTES,
  uploadFiles,
} from "../../lib/attachments";
import { isDesktop } from "../../lib/desktop";
import { playSound } from "../../lib/sounds";
import { useChannelSession } from "../../lib/use-channel";
import {
  showUnfocusedNotification,
  useDesktopNotifications,
} from "../../lib/use-desktop-notifications";
import { useLiveUnreadBadge } from "../../lib/use-desktop-unread";
import { useWebPush } from "../../lib/use-web-push";
import {
  type CategoryView,
  type MemberView,
  type RoleView,
  resolveViewerPermissions,
} from "../../lib/workspace-admin";
import { type ChatSearchHit, useChat } from "../../providers/ChatProvider";
import { useDesktopUpdates } from "../../providers/DesktopUpdateProvider";
import { useVoice } from "../../providers/VoiceProvider";
import {
  useWorkspaceUpdates,
  WorkspaceUpdateProvider,
} from "../../providers/WorkspaceUpdateProvider";
import { AdminPanel, type AdminPanelViewer } from "../admin/AdminPanel";
import { KanbanView } from "../kanban/KanbanView";
import { DesktopUpdateSettings } from "../UpdateSettings";
import { CallDock } from "../voice/CallDock";
import { CallStage } from "../voice/CallStage";
import { DeviceSettingsSection } from "../voice/DeviceSettingsSection";
import { IncomingCallModal } from "../voice/IncomingCallModal";
import type { CallIdentity } from "../voice/identity";
import { VoiceChannelView } from "../voice/VoiceChannelView";
import { WorkspaceMenu } from "../WorkspaceMenu";
import { ChannelMembersModal } from "./ChannelMembersModal";
import { ChannelPane } from "./ChannelPane";
import { ChannelSidebar, type ChannelUnread } from "./ChannelSidebar";
import { CreateCategoryModal } from "./CreateCategoryModal";
import { type CreateChannelInput, CreateChannelModal } from "./CreateChannelModal";
import { channelEditBaseline, commitChannelEdit } from "./channel-edit";
import { EditChannelModal, type EditChannelPatch } from "./EditChannelModal";
import { MemberProfilePopover } from "./MemberProfilePopover";
import { MembersPanel } from "./MembersPanel";
import { NewConversationDialog } from "./NewConversationDialog";
import { NotificationsSettingsSection } from "./NotificationsSettingsSection";
import type { PresenceStatus } from "./PresenceAvatar";
import { RenameChannelModal } from "./RenameChannelModal";
import { type RestoreTracking, restoreMentionedChannels } from "./restore-channels";
import { type SearchArchiveState, SearchPanel } from "./SearchPanel";
import { type ThreadInboxItem, ThreadsInbox } from "./ThreadsInbox";
import { ThreadsPanel } from "./ThreadsPanel";
import { UserSettingsView } from "./UserSettingsView";

export interface ChatViewProps {
  readonly workspaceName: string;
  readonly workspaceIconSeed: string;
  readonly ownUserId: string;
  readonly ownName: string;
  readonly permissions: bigint;
  readonly kanbanEnabled?: boolean;
  readonly members: readonly {
    userId: string;
    displayName: string;
    roleIds?: readonly string[];
    roleNames?: readonly string[];
    isOwner?: boolean;
    roleColor?: string | null;
  }[];
  readonly roles: readonly RoleMentionTarget[];
  /** Live per-channel unread state from the server, keyed by channel id. */
  readonly unreadByChannel: ReadonlyMap<string, ChannelUnread>;
  readonly admin: {
    readonly viewer: AdminPanelViewer;
    readonly ownerId: string | null;
    readonly roleViews: readonly RoleView[];
    readonly memberViews: readonly MemberView[];
    readonly categories: readonly CategoryView[];
  };
  readonly onSignOut: () => void;
}

const LAST_CHANNEL_KEY = "aulora.lastChannel.v1:";
const MEMBERS_OPEN_KEY = "aulora.membersOpen.v1";
const MESSAGE_ALIGNMENT_KEY = "aulora.messageAlignment.v1";
function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "Something went wrong. Please try again.";
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
  members,
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
  const [mainView, setMainView] = useState<"chat" | "threads" | "kanban">("chat");
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

  const createCategory = useMutation(api.categories.create);
  const updateCategory = useMutation(api.categories.update);
  const removeCategory = useMutation(api.categories.remove);
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
  const profileMember = members.find((member) => member.userId === profileTarget?.userId);
  const kickMember = useMutation(api.members.kick);
  const banMember = useMutation(api.members.ban);

  // The Threads inbox is always subscribed so its tab can badge mentions.
  const threadRows = useQuery(api.messages.threadInbox, {});
  // The effective single-upload cap, so the composer can reject oversized picks
  // before any bytes leave the browser. Falls back to the shared default while
  // the query loads.
  const publicConfig = useQuery(api.server.publicConfig, {});
  const maxUploadBytes = publicConfig?.uploads?.maxBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const threadMentionCount = useMemo(
    () => (threadRows ?? []).filter((row) => row.viewerMentioned).length,
    [threadRows],
  );

  const mutedChannelIds = useMemo(
    () =>
      new Set(channels.filter((channel) => channel.muted === true).map((channel) => channel.id)),
    [channels],
  );
  useDesktopNotifications(runtime, ownUserId, channelNames, mutedChannelIds);
  useWebPush(runtime);
  useLiveUnreadBadge();

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
        playSound(message.mentionUserIds.includes(ownUserId) ? "mention" : "message");
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

  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      map.set(member.userId, member.displayName);
    }
    return map;
  }, [members]);

  const memberColors = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      if (
        member.roleColor !== null &&
        member.roleColor !== undefined &&
        member.roleColor.length > 0
      ) {
        map.set(member.userId, member.roleColor);
      }
    }
    return map;
  }, [members]);

  const callIdentity = useMemo<CallIdentity>(
    () => ({
      nameOf: (id: string) => (id === ownUserId ? ownName : (memberNames.get(id) ?? "Member")),
      colorOf: (id: string) => memberColors.get(id) ?? null,
    }),
    [ownUserId, ownName, memberNames, memberColors],
  );

  const presenceByUser = useMemo(
    () => new Map(presence.map((row) => [row.userId, row.status] as const)),
    [presence],
  );
  const presenceOf = useCallback(
    (userId: string): PresenceStatus => presenceByUser.get(userId) ?? "offline",
    [presenceByUser],
  );
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
      ...members.map((member) => member.displayName),
      ...roles.filter((r) => r.mentionable).map((r) => r.name),
    ],
    [members, roles],
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
    for (const row of presence) {
      if (row.customStatus !== null && row.customStatus.length > 0) {
        setCustomStatuses((current) => {
          const next = new Map(current);
          next.set(row.userId, row.customStatus as string);
          return next;
        });
      }
    }
  }, [presence]);

  // Seed the settings dialog's custom status from live presence when it opens.
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
  const viewerMember = admin.memberViews.find((entry) => entry.userId === ownUserId) ?? null;
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
  const sessionState = useChannelSession(runtime, activeChannelId, ownUserId);

  // Who can actually see the open channel; falls back to the workspace list
  // while the query loads so the member panel never flashes empty.
  const visibleMemberIds = useQuery(
    api.channels.visibleMemberIds,
    channel !== undefined ? { channelId: channel.id as never } : "skip",
  );
  const visibleMembers = useMemo(
    () =>
      visibleMemberIds === undefined
        ? members
        : members.filter((member) =>
            (visibleMemberIds as readonly string[]).includes(member.userId),
          ),
    [members, visibleMemberIds],
  );

  const channelRoleOptions = useMemo(
    () => roles.map((role) => ({ id: role.roleId, name: role.name })),
    [roles],
  );

  // Mark the newest message read while the reader can actually see it.
  const newest = sessionState.messages.at(-1);
  useEffect(() => {
    if (
      runtime === undefined ||
      activeChannelId === undefined ||
      newest === undefined ||
      !attentive ||
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
    sessionState.readStateLoaded,
    sessionState.readState,
  ]);

  const canCreateChannel = hasPermission(permissions, Permission.ManageChannels);
  const canManageChannels =
    admin.viewer.isOwner || hasPermission(permissions, Permission.ManageChannels);
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
  const canMentionEveryone = hasPermission(channelPermissions, Permission.MentionEveryone);

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
      members.map((member) => ({
        userId: member.userId,
        displayName: member.displayName,
        ...(member.roleIds !== undefined ? { roleIds: member.roleIds } : {}),
      })),
    [members],
  );

  const memberIds = useMemo(() => members.map((member) => member.userId), [members]);

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
    const map = new Map<string, { authorName: string; text: string; authorId: string }>();
    for (const message of mergedMessages) {
      map.set(message.id, {
        authorName:
          message.authorId === ownUserId
            ? ownName
            : (memberNames.get(message.authorId) ?? "Unknown member"),
        text: mergedDecrypted.get(message.id) ?? message.body,
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
  // idempotent and subscribes the channel's live message stream.
  const activeSummary = channel;
  const activeChannelKey = activeSummary?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the channel id, not the object identity
  useEffect(() => {
    if (runtime === undefined || activeSummary === undefined) {
      return;
    }
    void runtime.session.openChannel(activeSummary).then(() => {
      if (activeSummary.name.length > 0) {
        chat.reportChannelNames([{ id: activeSummary.id, name: activeSummary.name }]);
      }
      void runtime.session.receiveMessages(sessionState.messages);
    });
  }, [runtime, activeChannelKey]);

  const openChannel = useCallback((channelId: string) => {
    setAdminOpen(false);
    setUserSettingsOpen(false);
    setMainView("chat");
    setActiveChannelId(channelId);
    setThreadRoot(undefined);
    setReplyTarget(undefined);
    setMobilePane("chat");
    setSendError(null);
  }, []);

  const startConversation = useCallback(
    async (userIds: readonly string[]) => {
      if (runtime === undefined || userIds.length === 0) {
        return;
      }
      setNewConversationOpen(false);
      setAdminOpen(false);
      setUserSettingsOpen(false);
      setMainView("chat");
      const channelId = await createConversation(runtime, userIds);
      setActiveChannelId(channelId);
      setThreadRoot(undefined);
      setReplyTarget(undefined);
      setMobilePane("chat");
    },
    [runtime],
  );

  // A Threads-inbox row opens the existing thread panel for its root message.
  const openThreadFromInbox = useCallback((thread: ThreadInboxItem) => {
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
  }, []);

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
      mentionChannelIds?: readonly string[];
      mentionCategoryIds?: readonly string[];
      files: readonly File[];
    },
    extra: { threadRootId?: string; replyToId?: string } = {},
  ): Promise<string | undefined> => {
    let attachments: readonly AttachmentDescriptor[] | undefined;
    if (input.files.length > 0) {
      try {
        attachments = await uploadFiles(runtime.port, input.files, { maxBytes: maxUploadBytes });
      } catch (error) {
        setSendError(attachmentUploadErrorMessage(error));
        return undefined;
      }
    }
    setSendError(null);
    typing.reset(targetChannelId);
    void runtime.port.clearTyping({ channelId: targetChannelId }).catch(() => undefined);
    const result = await chat.sendMessage(targetChannelId, input.text, {
      mentionUserIds: input.mentionUserIds,
      ...(input.mentionChannelIds !== undefined
        ? { mentionChannelIds: input.mentionChannelIds }
        : {}),
      ...(input.mentionCategoryIds !== undefined
        ? { mentionCategoryIds: input.mentionCategoryIds }
        : {}),
      ...(extra.threadRootId !== undefined ? { threadRootId: extra.threadRootId } : {}),
      ...(extra.replyToId !== undefined ? { replyToId: extra.replyToId } : {}),
      ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
    });
    if (result.error !== undefined) {
      setSendError(result.error);
      return undefined;
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
  const rightPanel =
    threadRoot !== undefined && channel !== undefined ? "thread" : membersOpen ? "members" : null;
  const callTitle =
    voice.call !== null ? (titles.get(voice.call.channelId) ?? channel?.name ?? "") : "";
  const incomingCall = voice.incoming[0];

  const submitChannelEdit = async (patch: EditChannelPatch) => {
    const target = editChannelModal;
    if (target === undefined) {
      return;
    }
    setEditChannelBusy(true);
    setEditChannelError(null);
    try {
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
    <div className="relative flex min-h-0 min-w-0 flex-1 gap-2.5">
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
            memberNameOf={(id) => (id === ownUserId ? ownName : (memberNames.get(id) ?? "Member"))}
            activeChannelId={activeChannelId}
            unreadByChannel={sidebarUnread}
            canCreateChannel={canCreateChannel}
            mainView={mainView}
            {...(kanbanEnabled && hasPermission(permissions, Permission.ViewKanban)
              ? {
                  onOpenKanban: () => {
                    setMainView("kanban");
                    setMobilePane("chat");
                    setThreadRoot(undefined);
                    setAdminOpen(false);
                    setUserSettingsOpen(false);
                  },
                }
              : {})}
            threadMentionCount={threadMentionCount}
            onOpenThreads={() => {
              setMainView("threads");
              setThreadRoot(undefined);
              setAdminOpen(false);
              setUserSettingsOpen(false);
            }}
            onCreateCategory={() => {
              setCreateCategoryOpen(true);
            }}
            canManageCategories={canManageCategories}
            appUpdateAvailable={desktopUpdate.status?.updateAvailable ?? false}
            workspaceUpdateAvailable={workspaceUpdate.available}
            onOpenUserSettings={() => {
              setAdminOpen(false);
              setUserSettingsOpen(true);
            }}
            showAdmin={showAdmin}
            onOpenAdmin={() => {
              setUserSettingsOpen(false);
              setAdminOpen(true);
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
              copyLink: (channel) => {
                const url = `${window.location.origin}/?channel=${channel.id}`;
                void navigator.clipboard.writeText(url).catch(() => undefined);
              },
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
            onSignOut={onSignOut}
          />
        </div>
      )}

      {adminView ? (
        <AdminPanel
          viewer={admin.viewer}
          ownerId={admin.ownerId}
          roles={admin.roleViews}
          members={admin.memberViews}
          categories={admin.categories}
          channels={channels}
          channelNames={channelNames}
          origin={typeof window === "undefined" ? "" : window.location.origin}
          onClose={() => {
            setAdminOpen(false);
          }}
        />
      ) : userSettingsOpen ? (
        <UserSettingsView
          ownUserId={ownUserId}
          ownName={ownName}
          ownBio={ownProfile?.bio ?? ""}
          busy={ownProfile === undefined}
          alignment={alignment}
          canEditNickname={canEditNickname}
          isOwner={admin.viewer.isOwner}
          onSave={saveUserSettings}
          hasAvatar={
            admin.memberViews.find((member) => member.userId === ownUserId)?.avatarUrl != null
          }
          onChangeAvatar={changeAvatar}
          onClearAvatar={async () => {
            await setAvatar({});
          }}
          onBack={() => {
            setUserSettingsOpen(false);
          }}
          onSignOut={onSignOut}
          voiceSettings={<DeviceSettingsSection />}
          soundSettings={<NotificationsSettingsSection />}
          {...(isDesktop() ? { updateSettings: <DesktopUpdateSettings /> } : {})}
          updateAvailable={updateAvailable}
        />
      ) : mainView === "kanban" &&
        kanbanEnabled &&
        hasPermission(permissions, Permission.ViewKanban) ? (
        <KanbanView
          ownUserId={ownUserId}
          permissions={permissions}
          members={members}
          onBack={() => {
            setMainView("chat");
            setMobilePane("list");
          }}
        />
      ) : (
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
              channelNames={channelNames}
              memberNames={memberNames}
              memberColors={memberColors}
              titles={titles}
              ownUserId={ownUserId}
              onOpen={openThreadFromInbox}
            />
          ) : channel === undefined ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
                <Icon name="message" size={24} />
              </span>
              <h2 className="text-lg font-semibold text-text">
                {channels.length === 0 ? "No conversations yet" : "Pick a conversation"}
              </h2>
              <p className="max-w-xs text-sm text-text-muted">
                {channels.length === 0
                  ? canCreateChannel
                    ? "Create a channel from the sidebar, or start a direct message."
                    : "Start a direct message, or ask an admin to add you to a channel."
                  : "Choose a channel or direct message from the sidebar."}
              </p>
            </div>
          ) : channel.kind === "voice" ? (
            <VoiceChannelView channel={channel} title={title} identity={callIdentity} />
          ) : (
            <ChannelPane
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
              failedIds={failedIds}
              replyPreviews={replyPreviews}
              memberNames={memberNames}
              memberColors={memberColors}
              mentionNames={mentionNames}
              mentionMembers={mentionMembers}
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
      )}

      {rightPanel !== null &&
        channel !== undefined &&
        !adminView &&
        mainView !== "kanban" &&
        !userSettingsOpen &&
        mainView === "chat" && (
          <div className="fixed inset-y-2.5 right-2.5 z-30 flex lg:static lg:z-auto">
            {rightPanel === "thread" && threadRoot !== undefined ? (
              <ThreadsPanel
                key={threadRoot.id}
                runtime={runtime}
                channelId={channel.id}
                channelTitle={
                  channel.kind === "text" || channel.kind === "announcement" ? `#${title}` : title
                }
                root={threadRoot}
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
                  await sendWithFiles(channel.id, input, { threadRootId: threadRoot.id });
                  if (alsoSendToChannel) {
                    await sendWithFiles(channel.id, { ...input, files: [] });
                  }
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
                presence={presence}
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
          title={titles.get(incomingCall.channelId) ?? ""}
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
        <CallDock title={callTitle} identity={callIdentity} />
      )}
      {voice.view === "stage" && <CallStage title={callTitle} identity={callIdentity} />}

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
          members={members}
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
        members={members}
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
          members={members}
          {...(membersModalChannel.memberIds !== undefined
            ? { memberIds: membersModalChannel.memberIds }
            : {})}
          ownUserId={ownUserId}
          presenceOf={presenceOf}
          canManage={admin.viewer.isOwner || hasPermission(permissions, Permission.ManageChannels)}
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
          ownUserId={ownUserId}
          members={members}
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
