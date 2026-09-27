import {
  type AttachmentDescriptor,
  type ChannelSummary,
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
import { uploadFiles } from "../../lib/attachments";
import { useChannelSession } from "../../lib/use-channel";
import { useDesktopNotifications } from "../../lib/use-desktop-notifications";
import { useLiveUnreadBadge } from "../../lib/use-desktop-unread";
import { useWebPush } from "../../lib/use-web-push";
import type { CategoryView, MemberView, RoleView } from "../../lib/workspace-admin";
import { type ChatSearchHit, useChat } from "../../providers/ChatProvider";
import { AdminPanel, type AdminPanelViewer } from "../admin/AdminPanel";
import { WorkspaceMenu } from "../WorkspaceMenu";
import { ChannelMembersModal } from "./ChannelMembersModal";
import { ChannelSidebar, type ChannelUnread } from "./ChannelSidebar";
import { Composer } from "./Composer";
import { ConversationHeader } from "./ConversationHeader";
import { CreateCategoryModal } from "./CreateCategoryModal";
import { type CreateChannelInput, CreateChannelModal } from "./CreateChannelModal";
import { MembersPanel } from "./MembersPanel";
import { MessageList } from "./MessageList";
import { NewConversationDialog } from "./NewConversationDialog";
import type { PresenceStatus } from "./PresenceAvatar";
import { RenameChannelModal } from "./RenameChannelModal";
import { SearchPanel } from "./SearchPanel";
import { type ThreadInboxItem, ThreadsInbox } from "./ThreadsInbox";
import { ThreadsPanel } from "./ThreadsPanel";
import { UserSettingsView } from "./UserSettingsView";

export interface ChatViewProps {
  readonly workspaceName: string;
  readonly workspaceIconSeed: string;
  readonly ownUserId: string;
  readonly ownName: string;
  readonly permissions: bigint;
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
const REPLY_PREVIEW_MAX = 120;

function truncateReply(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > REPLY_PREVIEW_MAX
    ? `${trimmed.slice(0, REPLY_PREVIEW_MAX - 1)}…`
    : trimmed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "Something went wrong. Please try again.";
}

function readLocal(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Preferences are best-effort.
  }
}

function readAttentive(): boolean {
  return (
    typeof document === "undefined" ||
    (document.visibilityState === "visible" && (document.hasFocus?.() ?? true))
  );
}

/** Whether the page is visible and focused, i.e. the reader can see new messages. */
function useAttentive(): boolean {
  const [attentive, setAttentive] = useState(readAttentive);
  useEffect(() => {
    const update = () => setAttentive(readAttentive());
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
export function ChatView({
  workspaceName,
  workspaceIconSeed,
  ownUserId,
  ownName,
  permissions,
  members,
  roles,
  unreadByChannel,
  admin,
  onSignOut,
}: ChatViewProps) {
  const {
    runtime,
    channels,
    channelNames,
    presence,
    reportChannelNames,
    ready,
    outbox,
    sendMessage,
    retrySend,
    discardSend,
    search,
  } = useChat();
  const lastChannelKey = `${LAST_CHANNEL_KEY}${workspaceName}`;
  const [activeChannelId, setActiveChannelId] = useState<string | undefined>(
    () => readLocal(lastChannelKey) ?? undefined,
  );
  const [mobilePane, setMobilePane] = useState<"list" | "chat">("list");
  const [mainView, setMainView] = useState<"chat" | "threads">("chat");
  const [adminOpen, setAdminOpen] = useState(false);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [createChannelCategoryId, setCreateChannelCategoryId] = useState<string | undefined>(
    undefined,
  );
  const [createCategoryOpen, setCreateCategoryOpen] = useState(false);
  const [categoryModal, setCategoryModal] = useState<{ category: CategoryView } | null>(null);
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [membersModalChannel, setMembersModalChannel] = useState<ChannelView | null>(null);
  const [renameModalChannel, setRenameModalChannel] = useState<ChannelView | null>(null);
  const [threadRoot, setThreadRoot] = useState<MessagePayload | null>(null);
  const [replyTarget, setReplyTarget] = useState<MessagePayload | null>(null);
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);
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
  const [sendError, setSendError] = useState<string | null>(null);
  const [unreadAnchor, setUnreadAnchor] = useState<{
    channelId: string;
    messageId: string | null;
  } | null>(null);
  const reported = useRef(new Set<string>());
  const attentive = useAttentive();

  const createCategory = useMutation(api.categories.create);
  const updateCategory = useMutation(api.categories.update);
  const removeCategory = useMutation(api.categories.remove);
  const setNickname = useMutation(api.members.setNickname);

  // The Threads inbox is always subscribed so its tab can badge mentions.
  const threadRows = useQuery(api.messages.threadInbox, {});
  const threadMentionCount = useMemo(
    () => (threadRows ?? []).filter((row) => row.viewerMentioned).length,
    [threadRows],
  );

  useDesktopNotifications(runtime, ownUserId, channelNames);
  useWebPush(runtime);
  useLiveUnreadBadge();

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
          channel.name !== null &&
          channel.name.length > 0 &&
          !reported.current.has(`${channel.id}:${channel.name}`),
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
    reportChannelNames(pending.map(({ id, name }) => ({ id, name })));
  }, [runtime, channels, reportChannelNames]);

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
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The native Cmd+K menu item emits a shell event; open the same palette.
  useEffect(() => {
    const onQuickSwitcher = () => setSearchOpen(true);
    window.addEventListener("aulora:quick-switcher", onQuickSwitcher);
    return () => window.removeEventListener("aulora:quick-switcher", onQuickSwitcher);
  }, []);

  // The native View > Toggle Sidebar menu item hides/shows the channel list.
  useEffect(() => {
    const onToggleSidebar = () => setSidebarHidden((hidden) => !hidden);
    window.addEventListener("aulora:toggle-sidebar", onToggleSidebar);
    return () => window.removeEventListener("aulora:toggle-sidebar", onToggleSidebar);
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
    const timer = setTimeout(() => {
      void search(trimmed).then((hits) => {
        setSearchResults(hits);
        setSearching(false);
      });
    }, 120);
    return () => clearTimeout(timer);
  }, [searchOpen, searchQuery, search]);

  useEffect(() => {
    writeLocal(MEMBERS_OPEN_KEY, String(membersOpen));
  }, [membersOpen]);

  const channel = channels.find((entry) => entry.id === activeChannelId);
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

  // Freeze the "New messages" divider when a channel's history and read cursor
  // first arrive, so reading (which moves the cursor) does not make it jump.
  useEffect(() => {
    if (
      activeChannelId === undefined ||
      sessionState.loading ||
      !sessionState.readStateLoaded ||
      unreadAnchor?.channelId === activeChannelId
    ) {
      return;
    }
    setUnreadAnchor({ channelId: activeChannelId, messageId: sessionState.unread.firstUnreadId });
  }, [
    activeChannelId,
    sessionState.loading,
    sessionState.readStateLoaded,
    sessionState.unread.firstUnreadId,
    unreadAnchor,
  ]);

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
  const canManageCategories =
    admin.viewer.isOwner || hasPermission(permissions, Permission.ManageChannels);
  const canEditNickname =
    admin.viewer.isOwner || hasPermission(permissions, Permission.ChangeOwnNickname);
  const canSend =
    channel === undefined ||
    channel.kind === "dm" ||
    channel.kind === "group_dm" ||
    hasPermission(permissions, Permission.SendMessages);

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
      if (activeSummary.name !== null && activeSummary.name.length > 0) {
        reportChannelNames([{ id: activeSummary.id, name: activeSummary.name }]);
      }
      void runtime.session.receiveMessages(sessionState.messages);
    });
  }, [runtime, activeChannelKey]);

  const openChannel = useCallback(async (channelId: string) => {
    setAdminOpen(false);
    setUserSettingsOpen(false);
    setMainView("chat");
    setActiveChannelId(channelId);
    setThreadRoot(null);
    setReplyTarget(null);
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
      setThreadRoot(null);
      setReplyTarget(null);
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
      void openChannel(hit.channelId).then(() => {
        setTimeout(() => {
          const node = document.getElementById(`message-${hit.messageId}`);
          node?.scrollIntoView({ behavior: "smooth", block: "center" });
          node?.animate(
            [{ backgroundColor: "var(--aulora-accent-soft)" }, { backgroundColor: "transparent" }],
            { duration: 1600, easing: "ease-out" },
          );
        }, 160);
      });
    },
    [openChannel],
  );

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
    input: { text: string; mentionUserIds: readonly string[]; files: readonly File[] },
    extra: { threadRootId?: string; replyToId?: string } = {},
  ): Promise<string | undefined> => {
    let attachments: readonly AttachmentDescriptor[] | undefined;
    if (input.files.length > 0) {
      try {
        attachments = await uploadFiles(runtime.port, input.files);
      } catch {
        setSendError("Couldn't upload that attachment. Check the file size and try again.");
        return undefined;
      }
    }
    setSendError(null);
    typing.reset(targetChannelId);
    void runtime.port.clearTyping({ channelId: targetChannelId }).catch(() => undefined);
    const result = await sendMessage(targetChannelId, input.text, {
      mentionUserIds: input.mentionUserIds,
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

  const saveUserSettings = async (input: { alignment: "left" | "right"; nickname?: string }) => {
    writeLocal(MESSAGE_ALIGNMENT_KEY, input.alignment);
    setAlignment(input.alignment);
    if (input.nickname !== undefined) {
      await setNickname({ userId: ownUserId, nickname: input.nickname });
    }
    setUserSettingsOpen(false);
  };

  const showList = mobilePane === "list" || channel === undefined;
  const adminView = adminOpen && showAdmin;
  const rightPanel =
    threadRoot !== null && channel !== undefined ? "thread" : membersOpen ? "members" : null;

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
            activeChannelId={activeChannelId}
            unreadByChannel={sidebarUnread}
            canCreateChannel={canCreateChannel}
            onCreateCategory={() => setCreateCategoryOpen(true)}
            canManageCategories={canManageCategories}
            onOpenUserSettings={() => {
              setAdminOpen(false);
              setUserSettingsOpen(true);
            }}
            showAdmin={showAdmin}
            onOpenAdmin={() => {
              setUserSettingsOpen(false);
              setAdminOpen(true);
            }}
            workspaceMenu={<WorkspaceMenu />}
            onSelect={(channelId) => void openChannel(channelId)}
            onCreateChannel={() => setCreateChannelOpen(true)}
            categoryActions={{
              rename: (category) => setCategoryModal({ category }),
              delete: (category) => void removeCategory({ categoryId: category.id as never }),
              createChannel: (category) => {
                setCreateChannelCategoryId(category.id);
                setCreateChannelOpen(true);
              },
            }}
            channelActions={{
              open: (channel) => void openChannel(channel.id),
              invite: (channel) => setMembersModalChannel(channel),
              ...(admin.viewer.isOwner || hasPermission(permissions, Permission.ManageChannels)
                ? { rename: (channel: ChannelView) => setRenameModalChannel(channel) }
                : {}),
              markRead: (channel) => {
                const newestId = channel.id === activeChannelId ? newest?.id : undefined;
                if (newestId !== undefined) {
                  void runtime.session.markRead(channel.id, newestId).catch(() => undefined);
                }
              },
              copyLink: (channel) => {
                const url = `${window.location.origin}/?channel=${channel.id}`;
                void navigator.clipboard?.writeText(url).catch(() => undefined);
              },
              leave: (channel) => {
                void runtime.port.leaveChannel({ channelId: channel.id }).catch(() => undefined);
              },
              ...(admin.viewer.isOwner || hasPermission(permissions, Permission.ManageChannels)
                ? {
                    archive: (channel: ChannelView) => {
                      void archiveChannel(runtime, channel.id);
                    },
                  }
                : {}),
            }}
            onNewConversation={() => setNewConversationOpen(true)}
            onOpenSearch={() => setSearchOpen(true)}
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
          onClose={() => setAdminOpen(false)}
        />
      ) : userSettingsOpen ? (
        <UserSettingsView
          ownUserId={ownUserId}
          ownName={ownName}
          alignment={alignment}
          canEditNickname={canEditNickname}
          isOwner={admin.viewer.isOwner}
          onSave={saveUserSettings}
          onBack={() => setUserSettingsOpen(false)}
          onSignOut={onSignOut}
        />
      ) : (
        <section
          className={cn(
            "pane chat-canvas relative min-h-0 min-w-0 flex-1 flex-col",
            showList ? "hidden md:flex" : "flex",
          )}
          aria-label={mainView === "threads" ? "Threads inbox" : "Conversation"}
        >
          <MainTabs
            view={mainView}
            mentionCount={threadMentionCount}
            onSelect={(view) => {
              setMainView(view);
              if (view === "threads") {
                setAdminOpen(false);
                setUserSettingsOpen(false);
                setThreadRoot(null);
              }
            }}
          />
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
          ) : (
            <>
              <ConversationHeader
                channel={channel}
                title={title}
                ownUserId={ownUserId}
                memberCount={visibleMembers.length}
                presenceOf={presenceOf}
                membersOpen={rightPanel === "members"}
                onToggleMembers={() => {
                  setThreadRoot(null);
                  setMembersOpen((open) => (threadRoot !== null ? true : !open));
                }}
                onOpenSearch={() => setSearchOpen(true)}
                onBack={() => setMobilePane("list")}
              />
              <MessageList
                runtime={runtime}
                channelId={channel.id}
                messages={mergedMessages}
                decrypted={mergedDecrypted}
                attachments={attachmentsByMessage}
                pendingIds={pendingIds}
                failedIds={failedIds}
                onRetrySend={(pendingId) => {
                  void retrySend?.(pendingId.replace(/^pending:/, ""));
                }}
                onDiscardSend={(pendingId) => {
                  void discardSend?.(pendingId.replace(/^pending:/, ""));
                }}
                permissions={permissions}
                ownUserId={ownUserId}
                ownName={ownName}
                memberNames={memberNames}
                memberColors={memberColors}
                mentionNames={mentionNames}
                firstUnreadId={
                  unreadAnchor?.channelId === channel.id ? unreadAnchor.messageId : null
                }
                typers={sessionState.typers}
                hasOlder={sessionState.hasOlder}
                loading={sessionState.loading}
                onLoadOlder={sessionState.loadOlder}
                onReply={(message) => setThreadRoot(message)}
                onReplyTo={(message) => setReplyTarget(message)}
                replyPreviews={replyPreviews}
                ownSide={alignment}
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
                emptyState={<ConversationStart channel={channel} title={title} />}
              />
              {sendError !== null && (
                <div
                  role="alert"
                  className="mx-4 mb-1 flex items-center gap-2 rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger"
                >
                  <span className="flex-1">{sendError}</span>
                  <button type="button" aria-label="Dismiss" onClick={() => setSendError(null)}>
                    <Icon name="x" size={16} />
                  </button>
                </div>
              )}
              {canSend ? (
                <Composer
                  channelId={channel.id}
                  draftKey={channel.id}
                  members={mentionMembers}
                  roles={roles}
                  memberIds={memberIds}
                  placeholder={placeholder}
                  onTyping={(channelId) => typing.ping(channelId)}
                  onSend={async (input) => {
                    await sendWithFiles(
                      channel.id,
                      input,
                      replyTarget !== null ? { replyToId: replyTarget.id } : {},
                    );
                    setReplyTarget(null);
                  }}
                  replyTo={
                    replyTarget === null
                      ? null
                      : {
                          authorName:
                            replyTarget.authorId === ownUserId
                              ? ownName
                              : (memberNames.get(replyTarget.authorId) ?? "Unknown member"),
                          preview: truncateReply(
                            mergedDecrypted.get(replyTarget.id) ?? replyTarget.body,
                          ),
                        }
                  }
                  onCancelReply={() => setReplyTarget(null)}
                />
              ) : (
                <p className="m-4 rounded-[10px] border border-border bg-surface-2 px-4 py-3 text-center text-[13px] text-text-muted">
                  You can read this channel, but only some roles can post here.
                </p>
              )}
            </>
          )}
        </section>
      )}

      {rightPanel !== null &&
        channel !== undefined &&
        !adminView &&
        !userSettingsOpen &&
        mainView === "chat" && (
          <div className="fixed inset-y-2.5 right-2.5 z-30 flex lg:static lg:z-auto">
            {rightPanel === "thread" && threadRoot !== null ? (
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
                permissions={permissions}
                ownUserId={ownUserId}
                ownName={ownName}
                memberNames={memberNames}
                memberColors={memberColors}
                mentionNames={mentionNames}
                onClose={() => setThreadRoot(null)}
                onTyping={(channelId) => typing.ping(channelId)}
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
                    setThreadRoot(null);
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
                onMessage={(userId) => void startConversation([userId])}
                onClose={() => setMembersOpen(false)}
                memberActions={{
                  message: (userId) => void startConversation([userId]),
                  ...(showAdmin ? { assignRoles: () => setAdminOpen(true) } : {}),
                }}
              />
            )}
          </div>
        )}

      {searchOpen && (
        <SearchPanel
          query={searchQuery}
          results={searchResults}
          searching={searching}
          conversations={channels}
          titles={titles}
          ownUserId={ownUserId}
          memberNames={memberNames}
          onQueryChange={setSearchQuery}
          onSelectConversation={(channelId) => {
            setSearchOpen(false);
            void openChannel(channelId);
          }}
          onSelect={selectSearchHit}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {newConversationOpen && (
        <NewConversationDialog
          members={members}
          ownUserId={ownUserId}
          presenceOf={presenceOf}
          onStart={(userIds) => void startConversation(userIds)}
          onClose={() => setNewConversationOpen(false)}
        />
      )}

      <CreateChannelModal
        open={createChannelOpen}
        {...(createChannelCategoryId !== undefined
          ? { initialCategoryId: createChannelCategoryId }
          : {})}
        members={members}
        roles={channelRoleOptions}
        onClose={() => {
          setCreateChannelOpen(false);
          setCreateChannelCategoryId(undefined);
        }}
        onCreate={async (input: CreateChannelInput) => {
          setCreateChannelOpen(false);
          setCreateChannelCategoryId(undefined);
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

      {renameModalChannel !== null && (
        <RenameChannelModal
          open
          currentName={titles.get(renameModalChannel.id) ?? renameModalChannel.name}
          kindLabel={
            renameModalChannel.kind === "announcement" ? "announcement channel" : "channel"
          }
          onClose={() => setRenameModalChannel(null)}
          onRename={async (name) => {
            setRenameModalChannel(null);
            await runtime.session.setChannelName(renameModalChannel.id, name);
          }}
        />
      )}

      {membersModalChannel !== null && (
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
          onClose={() => setMembersModalChannel(null)}
        />
      )}
    </div>
  );
}

function MainTabs({
  view,
  mentionCount,
  onSelect,
}: {
  readonly view: "chat" | "threads";
  readonly mentionCount: number;
  readonly onSelect: (view: "chat" | "threads") => void;
}) {
  const tabs: readonly {
    readonly id: "chat" | "threads";
    readonly label: string;
    readonly icon: "message" | "thread";
  }[] = [
    { id: "chat", label: "Chat", icon: "message" },
    { id: "threads", label: "Threads", icon: "thread" },
  ];
  const badge = mentionCount > 9 ? "9+" : String(mentionCount);
  return (
    <div
      role="tablist"
      aria-label="Main view"
      className="material-chrome flex h-10 shrink-0 items-center gap-1 border-b border-border px-2"
    >
      {tabs.map((tab) => {
        const active = view === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`main-tab-${tab.id}`}
            onClick={() => onSelect(tab.id)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-[7px] px-3 text-[13px] font-medium transition",
              active
                ? "bg-surface-3 text-text"
                : "text-text-muted hover:bg-surface-2 hover:text-text",
            )}
          >
            <Icon name={tab.icon} size={15} />
            {tab.label}
            {tab.id === "threads" && mentionCount > 0 && (
              <span
                data-testid="threads-tab-badge"
                className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-on-accent"
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ConversationStart({
  channel,
  title,
}: {
  readonly channel: ChannelSummary;
  readonly title: string;
}) {
  const isChannel = channel.kind === "text" || channel.kind === "announcement";
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
        <Icon
          name={isChannel ? (channel.kind === "announcement" ? "announce" : "hash") : "message"}
          size={24}
        />
      </span>
      <h3 className="text-xl font-semibold tracking-tight text-text">
        {isChannel ? `Welcome to #${title}` : title}
      </h3>
      <p className="max-w-sm text-sm text-text-muted">
        {isChannel
          ? "This is the very beginning of the channel. Say hello."
          : "This is the start of your conversation."}
      </p>
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
