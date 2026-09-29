import {
  type AttachmentDescriptor,
  type ChannelSummary,
  type ChannelView,
  hasPermission,
  memoryOutboxStore,
  memorySearchStore,
  Outbox,
  type OutboxItem,
  Permission,
  type PresenceRow,
  type RoleMentionTarget,
  type SearchHit,
  SearchIndex,
} from "@aulora/core";
import { type ConvexReactClient, useQuery } from "convex/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { createMobileChatRuntime, type MobileChatRuntime } from "../lib/chat-runtime";
import { convexSubscriptions } from "../lib/convex-chat";
import {
  canManageChannels,
  type MemberView,
  type MobileMemberEntry,
  memberViewToEntry,
  type RoleView,
  resolveViewerPermissions,
  roleRef,
} from "../lib/permissions";
import { usePresenceHeartbeat } from "../lib/use-presence-heartbeat";

export type { MobileMemberEntry } from "../lib/permissions";

export interface ChatSendOptions {
  readonly mentionUserIds?: readonly string[];
  readonly mentionChannelIds?: readonly string[];
  readonly mentionCategoryIds?: readonly string[];
  readonly threadRootId?: string;
  readonly attachments?: readonly AttachmentDescriptor[];
}

export interface ChatSendResult {
  readonly queued: boolean;
  readonly messageId?: string;
}

export interface CategoryView {
  readonly id: string;
  readonly name: string;
  readonly position: number;
}

export interface MobileChatContextValue {
  readonly runtime: MobileChatRuntime | undefined;
  readonly ready: boolean;
  readonly channels: readonly ChannelView[];
  readonly categories: readonly CategoryView[];
  readonly presence: readonly PresenceRow[];
  readonly outbox: readonly OutboxItem[];
  /** Workspace members, flattened for the channel-edit picker. */
  readonly members: readonly MobileMemberEntry[];
  /** Mentionable roles with their member ids, for `@role` resolution. */
  readonly roles: readonly RoleMentionTarget[];
  /** The viewer's effective permission bitfield, resolved like the server. */
  readonly viewerPermissions: bigint;
  readonly isOwner: boolean;
  /** The workspace owner's user id, used for moderation hierarchy guards. */
  readonly ownerUserId: string | null;
  /** Owner or `ManageChannels`; gates the channel-edit surfaces. */
  readonly canManageChannels: boolean;
  readonly canKick: boolean;
  readonly canBan: boolean;
  readonly canTimeout: boolean;
  readonly canModerateMembers: boolean;
  /** Owner or `MentionEveryone`; gates `@everyone`/`@here` suggestions. */
  readonly canMentionEveryone: boolean;
  sendMessage(channelId: string, text: string, options?: ChatSendOptions): Promise<ChatSendResult>;
  search(query: string): Promise<readonly SearchHit[]>;
}

const ChatContext = createContext<MobileChatContextValue | null>(null);

export interface ChatProviderProps {
  readonly client: ConvexReactClient;
  readonly children: ReactNode;
}

/**
 * Owns the mobile chat runtime, device-local search and the offline outbox.
 * The server seals content at rest; this provider only ever handles plaintext.
 */
export function ChatProvider({ client, children }: ChatProviderProps) {
  const [runtime, setRuntime] = useState<MobileChatRuntime | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [summaries, setSummaries] = useState<readonly ChannelSummary[]>([]);
  const [presence, setPresence] = useState<readonly PresenceRow[]>([]);
  const [outbox, setOutbox] = useState<readonly OutboxItem[]>([]);
  const runtimeRef = useRef<MobileChatRuntime | undefined>(undefined);
  const outboxRef = useRef<Outbox | undefined>(undefined);
  const searchRef = useRef<SearchIndex | undefined>(undefined);

  usePresenceHeartbeat(runtime?.port);

  useEffect(() => {
    let cancelled = false;
    const outboxStore = new Outbox({ store: memoryOutboxStore() });
    const searchIndex = new SearchIndex(memorySearchStore());
    outboxRef.current = outboxStore;
    searchRef.current = searchIndex;
    void searchIndex.load();
    void outboxStore.list().then((items) => {
      if (!cancelled) {
        setOutbox(items);
      }
    });
    void createMobileChatRuntime({ client })
      .then((result) => {
        if (cancelled) {
          result.session.dispose();
          return;
        }
        runtimeRef.current = result;
        setRuntime(result);
        setReady(true);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        // A failed session start must not leave the shell spinning forever.
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[aulora] chat runtime failed to start: ${message}`);
        setReady(true);
      });
    return () => {
      cancelled = true;
      runtimeRef.current?.session.dispose();
      runtimeRef.current = undefined;
      outboxRef.current = undefined;
      searchRef.current = undefined;
    };
  }, [client]);

  useEffect(() => {
    const subs = convexSubscriptions(client);
    const offChannels = subs.watchChannels(setSummaries);
    const offPresence = subs.watchPresence(setPresence);
    return () => {
      offChannels();
      offPresence();
    };
  }, [client]);

  useEffect(() => {
    if (runtime === undefined) {
      return;
    }
    return runtime.session.onDecrypted((messages) => {
      const index = searchRef.current;
      if (index === undefined) {
        return;
      }
      for (const message of messages) {
        const text = runtime.session.decryptedText(message.id);
        if (text.length === 0) {
          continue;
        }
        void index.index({
          messageId: message.id,
          channelId: message.channelId,
          authorId: message.authorId,
          text,
          createdAt: message.createdAt,
        });
      }
    });
  }, [runtime]);

  const sendMessage = useCallback(
    async (
      channelId: string,
      text: string,
      options: ChatSendOptions = {},
    ): Promise<ChatSendResult> => {
      const chat = runtimeRef.current;
      const active = outboxRef.current;
      if (chat === undefined || active === undefined) {
        throw new Error("Chat is not ready yet.");
      }
      const hasPayload = text.trim().length > 0 || (options.attachments?.length ?? 0) > 0;
      if (!hasPayload) {
        return { queued: false };
      }
      const attachmentIds = (options.attachments ?? []).map((attachment) => attachment.fileId);
      const channelMentions = options.mentionChannelIds ?? [];
      const categoryMentions = options.mentionCategoryIds ?? [];
      try {
        const messageId = await chat.session.sendMessage(channelId, text, {
          ...(options.mentionUserIds !== undefined
            ? { mentionUserIds: options.mentionUserIds }
            : {}),
          ...(channelMentions.length > 0 ? { mentionChannelIds: channelMentions } : {}),
          ...(categoryMentions.length > 0 ? { mentionCategoryIds: categoryMentions } : {}),
          ...(options.threadRootId !== undefined ? { threadRootId: options.threadRootId } : {}),
          ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
        });
        return { queued: false, messageId };
      } catch {
        await active.enqueue(
          {
            channelId,
            text,
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
            ...(options.attachments !== undefined ? { attachments: options.attachments } : {}),
          },
          Date.now(),
        );
        setOutbox(await active.list());
        return { queued: true };
      }
    },
    [],
  );

  const search = useCallback(async (query: string): Promise<readonly SearchHit[]> => {
    const index = searchRef.current;
    if (index === undefined) {
      return [];
    }
    return index.query(query, { limit: 20 });
  }, []);

  const membersResult = useQuery(api.members.list, {});
  const rolesResult = useQuery(api.roles.list, {});
  const meResult = useQuery(api.members.me, {});
  const categoriesResult = useQuery(api.categories.list, {});

  const roleViews = useMemo<readonly RoleView[]>(
    () => (rolesResult ?? []) as readonly RoleView[],
    [rolesResult],
  );

  const memberViews = useMemo<readonly MemberView[]>(
    () => (membersResult ?? []) as readonly MemberView[],
    [membersResult],
  );

  const viewerUserId = meResult?.userId;
  const ownerId = meResult?.ownerId ?? null;
  const isOwner = meResult?.isOwner ?? false;
  const viewerMember = meResult?.member ?? null;

  const viewerPermissions = useMemo<bigint>(() => {
    if (viewerUserId === undefined) {
      return 0n;
    }
    return resolveViewerPermissions({
      viewer: { userId: viewerUserId, isOwner },
      member: viewerMember,
      roles: roleViews,
    });
  }, [viewerUserId, isOwner, viewerMember, roleViews]);

  const members = useMemo<readonly MobileMemberEntry[]>(
    () =>
      memberViews.map((member) =>
        memberViewToEntry(
          member,
          roleViews,
          ownerId,
          member.userId === viewerUserId ? "You" : "Member",
        ),
      ),
    [memberViews, roleViews, ownerId, viewerUserId],
  );

  const mentionRoles = useMemo<readonly RoleMentionTarget[]>(
    () =>
      roleViews.map((role) => {
        const ref = roleRef(role);
        return {
          roleId: ref,
          name: role.name,
          mentionable: role.mentionable,
          memberUserIds: memberViews
            .filter((member) => member.roleIds.includes(ref))
            .map((member) => member.userId),
        };
      }),
    [roleViews, memberViews],
  );

  const canManageChannelsForViewer = canManageChannels(isOwner, viewerPermissions);

  const categories = useMemo<readonly CategoryView[]>(
    () =>
      (categoriesResult ?? []).map((category) => ({
        id: category.id,
        name: category.name,
        position: category.position,
      })),
    [categoriesResult],
  );

  const canKick = isOwner || hasPermission(viewerPermissions, Permission.Kick);
  const canBan = isOwner || hasPermission(viewerPermissions, Permission.Ban);
  const canTimeout = isOwner || hasPermission(viewerPermissions, Permission.Timeout);
  const canModerateMembers = canKick || canBan || canTimeout;
  const canMentionEveryone =
    isOwner || hasPermission(viewerPermissions, Permission.MentionEveryone);

  const views = useMemo<readonly ChannelView[]>(
    () =>
      summaries.map((channel) => ({
        ...channel,
        name: channel.name ?? placeholder(channel),
      })),
    [summaries],
  );

  const value = useMemo<MobileChatContextValue>(
    () => ({
      runtime,
      ready,
      channels: views,
      categories,
      presence,
      outbox,
      members,
      roles: mentionRoles,
      viewerPermissions,
      isOwner,
      ownerUserId: ownerId,
      canManageChannels: canManageChannelsForViewer,
      canKick,
      canBan,
      canTimeout,
      canModerateMembers,
      canMentionEveryone,
      sendMessage,
      search,
    }),
    [
      runtime,
      ready,
      views,
      categories,
      presence,
      outbox,
      members,
      mentionRoles,
      viewerPermissions,
      isOwner,
      ownerId,
      canManageChannelsForViewer,
      canKick,
      canBan,
      canTimeout,
      canModerateMembers,
      canMentionEveryone,
      sendMessage,
      search,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

function placeholder(channel: ChannelSummary): string {
  if (channel.kind === "dm") {
    return "Direct message";
  }
  if (channel.kind === "group_dm") {
    return "Group message";
  }
  return channel.archived ? "archived" : "channel";
}

/** Reads the chat context; throws outside a {@link ChatProvider}. */
export function useChat(): MobileChatContextValue {
  const value = useContext(ChatContext);
  if (value === null) {
    throw new Error("useChat must be used within a ChatProvider.");
  }
  return value;
}
