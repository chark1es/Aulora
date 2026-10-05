import { Avatar } from "@aulora/avatars";
import type { ChannelView } from "@aulora/core";
import { activityLabel, badgeCount, dmPartnerId } from "@aulora/core";
import { ConfirmDialog, type ContextMenuItem, cn, Icon, useContextMenu } from "@aulora/ui-web";
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { CategoryView } from "../../lib/workspace-admin";
import { VoiceChannelRow } from "../voice/VoiceChannelRow";
import { ActiveBar } from "./ActiveBar";
import { GroupAvatar, PRESENCE_LABEL, PresenceAvatar, type PresenceStatus } from "./PresenceAvatar";

export interface ChannelUnread {
  readonly unread: boolean;
  readonly mentionCount: number;
  readonly lastActivityAt: number | null;
}

export interface ChannelSidebarProps {
  readonly workspaceName: string;
  readonly workspaceIconSeed: string;
  readonly ownUserId: string;
  readonly ownName: string;
  readonly ownStatus: PresenceStatus;
  readonly onlineCount: number;
  readonly channels: readonly ChannelView[];
  readonly categories: readonly CategoryView[];
  /** Display title per channel id (DMs are named after their members). */
  readonly titles: ReadonlyMap<string, string>;
  readonly presenceOf: (userId: string) => PresenceStatus;
  readonly activeChannelId: string | undefined;
  readonly unreadByChannel: ReadonlyMap<string, ChannelUnread>;
  readonly canCreateChannel: boolean;
  /** Which main pane is showing; drives the sidebar Threads row. */
  readonly mainView?: "chat" | "threads" | "kanban";
  readonly onOpenKanban?: () => void;
  /** Mentions across the viewer's threads; badges the Threads row. */
  readonly threadMentionCount?: number;
  /** Opens the Threads inbox from the sidebar row. */
  readonly onOpenThreads?: () => void;
  /** Create a category from the Channels header "+" chooser. */
  readonly onCreateCategory?: () => void;
  /** Whether the viewer may manage categories (adds "New category" to the chooser). */
  readonly canManageCategories?: boolean;
  /** Open the user settings surface from the account footer. */
  readonly onOpenUserSettings?: () => void;
  readonly appUpdateAvailable?: boolean;
  readonly workspaceUpdateAvailable?: boolean;
  /** Show the workspace admin control (the viewer has at least one admin flag). */
  readonly showAdmin?: boolean;
  readonly onOpenAdmin?: () => void;
  /**
   * Workspace switcher control rendered in the header. Injected so the
   * sidebar stays testable without a {@link ProfileProvider}.
   */
  readonly workspaceMenu?: ReactNode;
  /**
   * Full workspace switcher (trigger + menu) for the header. When set, it
   * replaces the static identity block and the `workspaceMenu` control.
   */
  readonly workspaceSwitcher?: ReactNode;
  readonly onSelect: (channelId: string) => void;
  /** Opens the create dialog, optionally pre-selecting the channel kind. */
  readonly onCreateChannel: (kind?: "text" | "voice") => void;
  readonly onNewConversation: () => void;
  readonly onOpenSearch: () => void;
  readonly onSetStatus: (status: PresenceStatus) => void;
  /** The viewer's current custom status; shown in the account status menu. */
  readonly customStatus?: string;
  /** Set or clear (empty string) the viewer's custom status. */
  readonly onSetCustomStatus?: (text: string) => void;
  /** Reorder channels via drag and drop; absent disables the feature. */
  readonly onReorderChannels?: (
    moves: readonly {
      readonly channelId: string;
      readonly categoryId: string | null;
      readonly position: number;
    }[],
  ) => void;
  /** Whether the viewer may drag channels between/within categories. */
  readonly canReorderChannels?: boolean;
  readonly onSignOut: () => void;
  /** Channel context-menu actions; absent entries are hidden. */
  readonly channelActions?: {
    readonly open?: (channel: ChannelView) => void;
    readonly invite?: (channel: ChannelView) => void;
    readonly rename?: (channel: ChannelView) => void;
    readonly edit?: (channel: ChannelView) => void;
    readonly markRead?: (channel: ChannelView) => void;
    readonly archive?: (channel: ChannelView) => void;
    readonly copyLink?: (channel: ChannelView) => void;
    readonly hide?: (channel: ChannelView) => void;
    readonly unhide?: (channel: ChannelView) => void;
    readonly mute?: (channel: ChannelView) => void;
    readonly unmute?: (channel: ChannelView) => void;
  };
  /** Resolves a member's display name for voice-channel participant lists. */
  readonly memberNameOf?: (userId: string) => string;
  /** Category context-menu actions; absent entries are hidden. */
  readonly categoryActions?: {
    readonly rename?: (category: CategoryView) => void;
    readonly delete?: (category: CategoryView) => void;
    readonly createChannel?: (category: CategoryView) => void;
  };
}

const COLLAPSED_KEY = "aulora.sidebar.collapsed.v1";

interface ChannelGroup {
  readonly key: string;
  readonly name: string;
  readonly channels: readonly ChannelView[];
  readonly category?: CategoryView;
}

/**
 * Stable sort by explicit position; channels without a position keep their
 * existing (creation) order rather than being shuffled by the sort.
 */
function sortByPosition(channels: readonly ChannelView[]): ChannelView[] {
  return channels
    .map((channel, index) => ({ channel, index }))
    .sort((a, b) => (a.channel.position ?? 0) - (b.channel.position ?? 0) || a.index - b.index)
    .map((entry) => entry.channel);
}

/** The rendered group key for a channel: its category id, or `channels`/`dms`. */
function groupKeyOf(channel: ChannelView, known: ReadonlySet<string>): string {
  if (channel.kind === "dm" || channel.kind === "group_dm") {
    return "dms";
  }
  return channel.categoryId !== null && known.has(channel.categoryId)
    ? channel.categoryId
    : "channels";
}

function readCollapsed(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(COLLAPSED_KEY);
    const parsed: unknown = raw === null || raw === undefined ? [] : JSON.parse(raw);
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [],
    );
  } catch {
    return new Set();
  }
}

/**
 * The workspace sidebar: header, quick switcher trigger, channels grouped by
 * category, direct messages ordered by activity, and the account footer.
 * Unread channels are bold; mentions get an accent count badge.
 */
export function ChannelSidebar(props: ChannelSidebarProps) {
  const {
    workspaceName,
    workspaceIconSeed,
    channels,
    categories,
    activeChannelId,
    unreadByChannel,
    canCreateChannel,
    onSelect,
  } = props;
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  const openMenu = useContextMenu();
  const [dragChannelId, setDragChannelId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ groupKey: string; index: number } | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
    } catch {
      // Collapse state is a nicety; ignore storage failures.
    }
  }, [collapsed]);

  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  const groups = useMemo(() => {
    const chat = channels.filter(
      (channel) =>
        (channel.kind === "text" || channel.kind === "announcement" || channel.kind === "voice") &&
        !channel.archived &&
        channel.hidden !== true,
    );
    const known = new Set(categories.map((category) => category.id));
    const sorted = [...categories].sort((a, b) => a.position - b.position);
    const result: ChannelGroup[] = [
      {
        key: "channels",
        name: "Channels",
        channels: sortByPosition(
          chat.filter((c) => c.categoryId === null || !known.has(c.categoryId)),
        ),
      },
    ];
    for (const category of sorted) {
      result.push({
        key: category.id,
        name: category.name,
        channels: sortByPosition(chat.filter((c) => c.categoryId === category.id)),
        category,
      });
    }
    return result;
  }, [channels, categories]);

  const knownCategoryIds = useMemo(
    () => new Set(categories.map((category) => category.id)),
    [categories],
  );

  const canReorder = props.canReorderChannels === true && props.onReorderChannels !== undefined;

  const clearDrag = () => {
    setDragChannelId(null);
    setDropTarget(null);
  };

  const startDrag = (channelId: string) => {
    draggingRef.current = true;
    setDragChannelId(channelId);
  };

  const endDrag = () => {
    clearDrag();
    // Let any trailing click from the drag settle before re-enabling navigation.
    window.setTimeout(() => {
      draggingRef.current = false;
    }, 0);
  };

  const selectChannel = (channelId: string) => {
    if (draggingRef.current) {
      return;
    }
    onSelect(channelId);
  };

  // The insertion index in a group's rendered list: the row whose midpoint the
  // pointer is above, or the list length when it is past every row.
  const dragOverList = (event: React.DragEvent, groupKey: string) => {
    if (!canReorder || dragChannelId === null) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer !== null) {
      event.dataTransfer.dropEffect = "move";
    }
    const rows = [
      ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[data-drag-index]"),
    ];
    let index = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as HTMLElement;
      const rect = row.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        index = i;
        break;
      }
    }
    setDropTarget((current) =>
      current !== null && current.groupKey === groupKey && current.index === index
        ? current
        : { groupKey, index },
    );
  };

  const movesForGroup = (groupKey: string, ordered: readonly ChannelView[]) => {
    const categoryId = groupKey === "channels" ? null : groupKey;
    return ordered.map((channel, index) => ({
      channelId: channel.id,
      categoryId,
      position: index,
    }));
  };

  const dropOnList = (groupKey: string) => {
    const dragId = dragChannelId;
    const drop = dropTarget;
    clearDrag();
    const reorder = props.onReorderChannels;
    if (dragId === null || drop === null || reorder === undefined) {
      return;
    }
    const targetGroup = groups.find((group) => group.key === groupKey);
    const dragged = channels.find((channel) => channel.id === dragId);
    if (targetGroup === undefined || dragged === undefined) {
      return;
    }

    const rendered = targetGroup.channels;
    const sourceIndex = rendered.findIndex((channel) => channel.id === dragId);
    let reducedIndex = drop.index;
    if (sourceIndex !== -1 && sourceIndex < drop.index) {
      reducedIndex -= 1;
    }
    const targetList = rendered.filter((channel) => channel.id !== dragId);
    targetList.splice(
      Math.max(0, Math.min(reducedIndex, targetList.length)),
      0,
      dragged as ChannelView,
    );

    const sourceKey = groupKeyOf(dragged, knownCategoryIds);
    if (sourceKey === targetGroup.key) {
      const unchanged = targetList.every((channel, index) => channel.id === rendered[index]?.id);
      if (unchanged) {
        return;
      }
      reorder(movesForGroup(targetGroup.key, targetList));
      return;
    }

    // Cross-category: re-index the source group so its remaining order sticks.
    const sourceGroup = groups.find((group) => group.key === sourceKey);
    const sourceList =
      sourceGroup === undefined
        ? []
        : sourceGroup.channels.filter((channel) => channel.id !== dragId);
    reorder([
      ...movesForGroup(targetGroup.key, targetList),
      ...movesForGroup(sourceKey, sourceList),
    ]);
  };

  const dragLeaveList = (event: React.DragEvent, groupKey: string) => {
    const next = event.relatedTarget as Node | null;
    if (next !== null && (event.currentTarget as HTMLElement).contains(next)) {
      return;
    }
    setDropTarget((current) => (current?.groupKey === groupKey ? null : current));
  };

  const hiddenChannels = useMemo(
    () => channels.filter((channel) => channel.hidden === true),
    [channels],
  );

  const dms = useMemo(
    () =>
      channels
        .filter(
          (channel) =>
            (channel.kind === "dm" || channel.kind === "group_dm") && channel.hidden !== true,
        )
        .sort(
          (a, b) =>
            (unreadByChannel.get(b.id)?.lastActivityAt ?? 0) -
            (unreadByChannel.get(a.id)?.lastActivityAt ?? 0),
        ),
    [channels, unreadByChannel],
  );

  const channelMenu = (channel: ChannelView, active: boolean) => {
    const actions = props.channelActions;
    const items: ContextMenuItem[] = [];
    if (actions?.open !== undefined) {
      items.push({
        id: "open",
        label: "Open channel",
        icon: <Icon name="message" size={14} />,
        onSelect: () => actions.open?.(channel),
      });
    }
    if (actions?.invite !== undefined) {
      items.push({
        id: "invite",
        label: "Add people…",
        icon: <Icon name="user-plus" size={14} />,
        onSelect: () => actions.invite?.(channel),
      });
    }
    if (actions?.rename !== undefined) {
      items.push({
        id: "rename",
        label: "Rename channel…",
        icon: <Icon name="pencil" size={14} />,
        onSelect: () => actions.rename?.(channel),
      });
    }
    if (actions?.edit !== undefined) {
      items.push({
        id: "edit",
        label: "Edit channel…",
        icon: <Icon name="pencil" size={14} />,
        onSelect: () => actions.edit?.(channel),
      });
    }
    if (actions?.markRead !== undefined && !active) {
      items.push({
        id: "markRead",
        label: "Mark as read",
        icon: <Icon name="check" size={14} />,
        onSelect: () => actions.markRead?.(channel),
      });
    }
    if (actions?.copyLink !== undefined) {
      items.push({
        id: "copyLink",
        label: "Copy link",
        icon: <Icon name="file" size={14} />,
        separatorBefore: items.length > 0,
        onSelect: () => actions.copyLink?.(channel),
      });
    }
    if (actions?.mute !== undefined && channel.muted !== true) {
      items.push({
        id: "mute",
        label: "Mute channel",
        icon: <Icon name="bell-off" size={14} />,
        separatorBefore: items.length > 0,
        onSelect: () => actions.mute?.(channel),
      });
    }
    if (actions?.unmute !== undefined && channel.muted === true) {
      items.push({
        id: "unmute",
        label: "Unmute channel",
        icon: <Icon name="bell" size={14} />,
        separatorBefore: items.length > 0,
        onSelect: () => actions.unmute?.(channel),
      });
    }
    if (actions?.hide !== undefined) {
      items.push({
        id: "hide",
        label: "Hide channel",
        icon: <Icon name="eye-off" size={14} />,
        onSelect: () => actions.hide?.(channel),
      });
    }
    if (actions?.unhide !== undefined && channel.hidden === true) {
      items.push({
        id: "unhide",
        label: "Unhide channel",
        icon: <Icon name="eye" size={14} />,
        onSelect: () => actions.unhide?.(channel),
      });
    }
    if (actions?.archive !== undefined) {
      items.push({
        id: "archive",
        label: "Archive channel",
        icon: <Icon name="trash" size={14} />,
        separatorBefore: items.length > 0,
        onSelect: () => actions.archive?.(channel),
      });
    }
    return items;
  };

  const categoryMenu = (category: CategoryView): ContextMenuItem[] => {
    const actions = props.categoryActions;
    const items: ContextMenuItem[] = [];
    if (actions?.rename !== undefined) {
      items.push({
        id: "rename",
        label: "Rename category…",
        icon: <Icon name="pencil" size={14} />,
        onSelect: () => actions.rename?.(category),
      });
    }
    if (actions?.createChannel !== undefined) {
      items.push({
        id: "createChannel",
        label: "Create channel here…",
        icon: <Icon name="plus" size={14} />,
        onSelect: () => actions.createChannel?.(category),
      });
    }
    if (actions?.delete !== undefined) {
      items.push({
        id: "delete",
        label: "Delete category",
        icon: <Icon name="trash" size={14} />,
        danger: true,
        separatorBefore: items.length > 0,
        onSelect: () => actions.delete?.(category),
      });
    }
    return items;
  };

  return (
    <aside
      className="pane flex h-full w-full flex-col border-r border-border md:w-[276px] md:shrink-0"
      aria-label="Conversations"
    >
      <div className="desktop-drag flex items-center gap-2.5 px-3 pb-2 pt-3">
        {props.workspaceSwitcher !== undefined ? (
          <div className="min-w-0 flex-1">{props.workspaceSwitcher}</div>
        ) : (
          <>
            <Avatar seed={workspaceIconSeed} size={32} shape="squircle" title={workspaceName} />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-text">
                {workspaceName}
              </h1>
              <p className="flex items-center gap-1.5 text-[11px] text-text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-secondary" aria-hidden="true" />
                {props.onlineCount} online
              </p>
            </div>
          </>
        )}
        {props.showAdmin === true && props.onOpenAdmin !== undefined && (
          <HeaderButton
            label={
              props.workspaceUpdateAvailable
                ? "Workspace settings (update available)"
                : "Workspace settings"
            }
            onClick={props.onOpenAdmin}
          >
            <span className="relative inline-flex">
              <Icon name="settings" size={17} />
              {props.workspaceUpdateAvailable && (
                <span
                  className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent ring-2 ring-surface-1"
                  role="img"
                  aria-label="Workspace update available"
                />
              )}
            </span>
          </HeaderButton>
        )}
        {props.workspaceSwitcher === undefined && props.workspaceMenu}
      </div>

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={props.onOpenSearch}
          className="flex h-8 w-full items-center gap-2 rounded-[8px] bg-surface-3 px-2.5 text-[13px] text-text-muted transition hover:text-text"
        >
          <Icon name="search" size={15} />
          <span className="flex-1 text-left">Jump to or search…</span>
          <kbd className="rounded-[5px] border border-border bg-surface-2 px-1.5 font-sans text-[10px] font-medium">
            ⌘K
          </kbd>
        </button>
      </div>

      {props.onOpenThreads !== undefined && (
        <div className="px-3 pb-2">
          <button
            type="button"
            data-testid="sidebar-threads"
            aria-current={props.mainView === "threads" ? "page" : undefined}
            onClick={props.onOpenThreads}
            className={cn(
              "relative flex h-8 w-full items-center gap-2.5 rounded-[8px] pl-3 pr-2 text-left text-[13px] transition",
              props.mainView === "threads"
                ? "bg-surface-3 font-semibold text-text"
                : "text-text-muted hover:bg-surface-3 hover:text-text",
            )}
          >
            <Icon
              name="thread"
              size={16}
              className={cn(props.mainView === "threads" && "text-accent")}
            />
            <span className="min-w-0 flex-1 truncate">Threads</span>
            {(props.threadMentionCount ?? 0) > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-on-accent">
                {(props.threadMentionCount ?? 0) > 9 ? "9+" : String(props.threadMentionCount)}
              </span>
            )}
          </button>
        </div>
      )}

      {props.onOpenKanban && (
        <div className="px-3 pb-2">
          <button
            type="button"
            data-testid="sidebar-kanban"
            aria-current={props.mainView === "kanban" ? "page" : undefined}
            onClick={props.onOpenKanban}
            className={cn(
              "flex h-8 w-full items-center gap-2.5 rounded-[8px] pl-3 pr-2 text-left text-[13px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              props.mainView === "kanban"
                ? "bg-surface-3 font-semibold text-text"
                : "text-text-muted hover:bg-surface-3 hover:text-text",
            )}
          >
            <Icon name="kanban" size={16} />
            <span>Kanban</span>
          </button>
        </div>
      )}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.map((group) => {
          const category = group.category;
          return (
            <section key={group.key} className="mt-2">
              <SectionHeader
                title={group.name}
                collapsed={collapsed.has(group.key)}
                onToggle={() => toggle(group.key)}
                {...(category !== undefined ? { testId: `category-header-${category.id}` } : {})}
                {...(category !== undefined
                  ? {
                      onContextMenu: (event: React.MouseEvent) => {
                        event.preventDefault();
                        const items = categoryMenu(category);
                        if (items.length > 0) {
                          openMenu({
                            clientX: event.clientX,
                            clientY: event.clientY,
                            items,
                            label: `Category ${category.name}`,
                          });
                        }
                      },
                    }
                  : {})}
                action={
                  category === undefined &&
                  (canCreateChannel || props.canManageCategories === true) ? (
                    <CreateMenuButton
                      canCreateChannel={canCreateChannel}
                      canManageCategories={props.canManageCategories === true}
                      onCreateChannel={props.onCreateChannel}
                      onCreateCategory={props.onCreateCategory}
                    />
                  ) : null
                }
              />
              {!collapsed.has(group.key) && (
                <ul
                  className="flex flex-col gap-px"
                  {...(canReorder
                    ? {
                        onDragOver: (event: React.DragEvent) => dragOverList(event, group.key),
                        onDragLeave: (event: React.DragEvent) => dragLeaveList(event, group.key),
                        onDrop: (event: React.DragEvent) => {
                          event.preventDefault();
                          dropOnList(group.key);
                        },
                      }
                    : {})}
                >
                  {group.channels.map((channel, index) => (
                    <Fragment key={channel.id}>
                      {dropTarget?.groupKey === group.key && dropTarget.index === index && (
                        <DropLine />
                      )}
                      <li className="animate-message-in">
                        {channel.kind === "voice" ? (
                          <VoiceChannelRow
                            channel={channel}
                            title={props.titles.get(channel.id) ?? channel.name}
                            active={channel.id === activeChannelId}
                            onSelect={selectChannel}
                            nameOf={props.memberNameOf ?? ((id: string) => id)}
                            onContextMenu={(event) => {
                              const items = channelMenu(channel, channel.id === activeChannelId);
                              if (items.length > 0) {
                                openMenu({
                                  clientX: event.clientX,
                                  clientY: event.clientY,
                                  items,
                                  label: `Channel ${props.titles.get(channel.id) ?? channel.name}`,
                                });
                              }
                            }}
                          />
                        ) : (
                          <ChannelRow
                            channel={channel}
                            title={props.titles.get(channel.id) ?? channel.name}
                            active={channel.id === activeChannelId}
                            unread={unreadByChannel.get(channel.id)}
                            onSelect={selectChannel}
                            {...(canReorder ? { dragIndex: index } : {})}
                            dragging={canReorder && dragChannelId === channel.id}
                            {...(canReorder
                              ? {
                                  onDragStart: () => startDrag(channel.id),
                                  onDragEnd: endDrag,
                                }
                              : {})}
                            onContextMenu={(event) => {
                              const items = channelMenu(channel, channel.id === activeChannelId);
                              if (items.length > 0) {
                                openMenu({
                                  clientX: event.clientX,
                                  clientY: event.clientY,
                                  items,
                                  label: `Channel ${props.titles.get(channel.id) ?? channel.name}`,
                                });
                              }
                            }}
                          />
                        )}
                      </li>
                    </Fragment>
                  ))}
                  {dropTarget?.groupKey === group.key &&
                    dropTarget.index >= group.channels.length && <DropLine />}
                  {group.channels.length === 0 && (
                    <li className="px-3 py-1.5 text-xs text-text-muted">No channels yet</li>
                  )}
                </ul>
              )}
            </section>
          );
        })}

        <section className="mt-4">
          <SectionHeader
            title="Direct messages"
            collapsed={collapsed.has("dms")}
            onToggle={() => toggle("dms")}
            action={
              <HeaderButton label="New direct message" small onClick={props.onNewConversation}>
                <Icon name="compose" size={14} />
              </HeaderButton>
            }
          />
          {!collapsed.has("dms") && (
            <ul className="flex flex-col gap-px">
              {dms.map((channel) => (
                <li key={channel.id}>
                  <DmRow
                    channel={channel}
                    title={props.titles.get(channel.id) ?? channel.name}
                    ownUserId={props.ownUserId}
                    presenceOf={props.presenceOf}
                    active={channel.id === activeChannelId}
                    unread={unreadByChannel.get(channel.id)}
                    onSelect={onSelect}
                  />
                </li>
              ))}
              {dms.length === 0 && (
                <li>
                  <button
                    type="button"
                    onClick={props.onNewConversation}
                    className="w-full rounded-[8px] px-3 py-2 text-left text-xs text-text-muted hover:bg-surface-3 hover:text-text"
                  >
                    Start a private conversation →
                  </button>
                </li>
              )}
            </ul>
          )}
        </section>

        {hiddenChannels.length > 0 && (
          <section className="mt-4">
            <SectionHeader
              title="Hidden channels"
              collapsed={collapsed.has("hidden")}
              onToggle={() => toggle("hidden")}
              action={null}
            />
            {!collapsed.has("hidden") && (
              <ul className="flex flex-col gap-px">
                {hiddenChannels.map((channel) => (
                  <li key={channel.id} className="flex items-center gap-px">
                    <button
                      type="button"
                      data-testid={`hidden-channel-row-${channel.id}`}
                      onClick={() => onSelect(channel.id)}
                      className="flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-[8px] pl-3 pr-1 text-left text-[13px] text-text-muted transition hover:bg-surface-3 hover:text-text"
                    >
                      <Icon
                        name={channel.kind === "voice" ? "volume" : "hash"}
                        size={15}
                        className="text-text-muted"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {props.titles.get(channel.id) ?? channel.name}
                      </span>
                    </button>
                    {props.channelActions?.unhide !== undefined && (
                      <HeaderButton
                        label={`Unhide ${props.titles.get(channel.id) ?? channel.name}`}
                        small
                        onClick={() => props.channelActions?.unhide?.(channel)}
                      >
                        <Icon name="eye" size={14} />
                      </HeaderButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </nav>

      <AccountFooter {...props} />
    </aside>
  );
}

function SectionHeader({
  title,
  collapsed,
  onToggle,
  action,
  testId,
  onContextMenu,
}: {
  readonly title: string;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly action: ReactNode;
  readonly testId?: string;
  readonly onContextMenu?: (event: React.MouseEvent) => void;
}) {
  return (
    <div className="flex items-center justify-between py-1 pl-1.5 pr-1">
      <button
        type="button"
        {...(testId !== undefined ? { "data-testid": testId } : {})}
        {...(onContextMenu !== undefined ? { onContextMenu } : {})}
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="flex items-center gap-1 rounded-[6px] px-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted transition hover:text-text"
      >
        <Icon
          name="chevron-down"
          size={11}
          className={cn("transition-transform", collapsed && "-rotate-90")}
        />
        {title}
      </button>
      {action}
    </div>
  );
}

function HeaderButton({
  label,
  onClick,
  children,
  small = false,
  hasPopup,
  expanded,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly small?: boolean;
  readonly hasPopup?: React.AriaAttributes["aria-haspopup"];
  readonly expanded?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...(hasPopup === undefined ? {} : { "aria-haspopup": hasPopup })}
      {...(expanded === undefined ? {} : { "aria-expanded": expanded })}
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[7px] text-text-muted transition hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        small ? "h-6 w-6" : "h-8 w-8",
      )}
    >
      {children}
    </button>
  );
}

function CreateMenuButton({
  canCreateChannel,
  canManageCategories,
  onCreateChannel,
  onCreateCategory,
}: {
  readonly canCreateChannel: boolean;
  readonly canManageCategories: boolean;
  readonly onCreateChannel: (kind?: "text" | "voice") => void;
  readonly onCreateCategory?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: PointerEvent) => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hasExtras = canManageCategories;
  const label = canManageCategories ? "Create channel or category" : "Create channel";

  return (
    <div ref={ref} className="relative">
      <HeaderButton
        label={label}
        small
        hasPopup="menu"
        expanded={open}
        onClick={() => {
          if (!hasExtras) {
            onCreateChannel("text");
            return;
          }
          setOpen((current) => !current);
        }}
      >
        <Icon name="plus" size={15} />
      </HeaderButton>
      {open && hasExtras && (
        <div
          role="menu"
          aria-label="Create"
          className="absolute right-0 top-full z-20 mt-1 min-w-[184px] animate-pop-in rounded-[10px] border border-border bg-surface-2 p-1 shadow-xl shadow-black/20"
        >
          {canCreateChannel && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onCreateChannel("text");
              }}
              className="flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-left text-[13px] text-text transition hover:bg-surface-3"
            >
              <Icon name="hash" size={14} className="text-text-muted" />
              New text channel
            </button>
          )}
          {canCreateChannel && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onCreateChannel("voice");
              }}
              className="flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-left text-[13px] text-text transition hover:bg-surface-3"
            >
              <Icon name="volume" size={14} className="text-text-muted" />
              New voice channel
            </button>
          )}
          {canManageCategories && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onCreateCategory?.();
              }}
              className="flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-left text-[13px] text-text transition hover:bg-surface-3"
            >
              <Icon name="plus" size={14} className="text-text-muted" />
              New category
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function UnreadBadge({ unread }: { readonly unread: ChannelUnread | undefined }) {
  const count = badgeCount(unread?.mentionCount ?? 0);
  if (count !== null) {
    return (
      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-on-accent">
        {count}
      </span>
    );
  }
  if (unread?.unread === true) {
    return (
      <span className="h-2 w-2 rounded-full bg-accent">
        <span className="sr-only">Unread</span>
      </span>
    );
  }
  return null;
}

function DropLine() {
  return (
    <li aria-hidden="true" className="h-0.5 px-1">
      <span className="block h-0.5 rounded-full bg-accent" />
    </li>
  );
}

function ChannelRow({
  channel,
  title,
  active,
  unread,
  onSelect,
  onContextMenu,
  dragIndex,
  dragging = false,
  onDragStart,
  onDragEnd,
}: {
  readonly channel: ChannelView;
  readonly title: string;
  readonly active: boolean;
  readonly unread: ChannelUnread | undefined;
  onSelect(channelId: string): void;
  onContextMenu(event: React.MouseEvent): void;
  readonly dragIndex?: number;
  readonly dragging?: boolean;
  readonly onDragStart?: () => void;
  readonly onDragEnd?: () => void;
}) {
  const isUnread = unread?.unread === true && !active;
  const isPrivate = channel.isPrivate === true;
  return (
    <button
      type="button"
      data-testid={`channel-row-${channel.id}`}
      onClick={() => onSelect(channel.id)}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(event);
      }}
      aria-current={active ? "page" : undefined}
      {...(dragIndex !== undefined ? { "data-drag-index": dragIndex, draggable: true } : {})}
      {...(onDragStart !== undefined
        ? {
            onDragStart: (event: React.DragEvent) => {
              if (event.dataTransfer !== null) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", channel.id);
              }
              onDragStart();
            },
          }
        : {})}
      {...(onDragEnd !== undefined ? { onDragEnd } : {})}
      className={cn(
        "relative flex h-8 w-full items-center gap-2.5 rounded-[8px] pl-3 pr-2 text-left text-[13px] transition",
        active
          ? "bg-surface-3 font-semibold text-text"
          : isUnread
            ? "font-semibold text-text hover:bg-surface-3"
            : "text-text-muted hover:bg-surface-3 hover:text-text",
        channel.muted === true && !active && !isUnread && "opacity-60",
        dragging && "opacity-40",
      )}
    >
      <ActiveBar active={active} />
      <Icon
        name={channel.kind === "announcement" ? "announce" : isPrivate ? "lock" : "hash"}
        size={16}
        className={cn("shrink-0", active && "text-accent")}
      />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {channel.muted === true && (
        <Icon name="bell-off" size={13} className="shrink-0 text-text-muted" />
      )}
      {!active && <UnreadBadge unread={unread} />}
    </button>
  );
}

function DmRow({
  channel,
  title,
  ownUserId,
  presenceOf,
  active,
  unread,
  onSelect,
}: {
  readonly channel: ChannelView;
  readonly title: string;
  readonly ownUserId: string;
  readonly presenceOf: (userId: string) => PresenceStatus;
  readonly active: boolean;
  readonly unread: ChannelUnread | undefined;
  onSelect(channelId: string): void;
}) {
  const partner = dmPartnerId(channel, ownUserId);
  const others = (channel.memberIds ?? []).filter((id) => id !== ownUserId);
  const status = partner !== undefined ? presenceOf(partner) : undefined;
  const isUnread = unread?.unread === true && !active;
  const subtitle =
    channel.kind === "group_dm"
      ? `${others.length + 1} members`
      : status !== undefined
        ? PRESENCE_LABEL[status]
        : "Direct message";
  return (
    <button
      type="button"
      data-testid={`channel-row-${channel.id}`}
      onClick={() => onSelect(channel.id)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex w-full items-center gap-2.5 rounded-[8px] py-1.5 pl-3 pr-2 text-left transition",
        active ? "bg-surface-3" : "hover:bg-surface-3",
      )}
    >
      <ActiveBar active={active} />
      {channel.kind === "group_dm" ? (
        <GroupAvatar userIds={others} size={32} />
      ) : (
        <PresenceAvatar
          userId={partner ?? ownUserId}
          size={32}
          status={status}
          ringClassName={active ? "ring-surface-3" : "ring-surface-1"}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-[13px]",
              active
                ? "font-semibold text-text"
                : isUnread
                  ? "font-semibold text-text"
                  : "font-medium text-text",
            )}
          >
            {title}
          </span>
          {unread?.lastActivityAt != null && (
            <span className="shrink-0 text-[11px] text-text-muted">
              {activityLabel(unread.lastActivityAt)}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-xs text-text-muted">{subtitle}</span>
          {!active && <UnreadBadge unread={unread} />}
        </span>
      </span>
    </button>
  );
}

export const STATUS_OPTIONS: readonly { value: PresenceStatus; label: string }[] = [
  { value: "online", label: "Online" },
  { value: "idle", label: "Idle" },
  { value: "dnd", label: "Do not disturb" },
  { value: "offline", label: "Invisible" },
];

function AccountFooter(props: ChannelSidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingStatus, setEditingStatus] = useState(false);
  const [statusDraft, setStatusDraft] = useState("");
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const statusInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointer = (event: PointerEvent) => {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // Discard an in-progress custom status whenever the menu closes.
  useEffect(() => {
    if (!menuOpen) {
      setEditingStatus(false);
    }
  }, [menuOpen]);

  useEffect(() => {
    if (editingStatus) {
      statusInputRef.current?.focus();
    }
  }, [editingStatus]);

  const statusLabel =
    STATUS_OPTIONS.find((option) => option.value === props.ownStatus)?.label ?? "Online";
  const customStatusText = props.customStatus ?? "";
  const hasCustomStatus = customStatusText.trim().length > 0;

  const saveCustomStatus = () => {
    setEditingStatus(false);
    props.onSetCustomStatus?.(statusDraft.trim());
  };

  return (
    <div ref={menuRef} className="relative border-t border-border p-2">
      {menuOpen && (
        <div
          role="menu"
          aria-label="Set your status"
          className="absolute bottom-full left-2 right-2 mb-1 animate-pop-in rounded-[10px] border border-border bg-surface-2 p-1 shadow-xl shadow-black/20"
        >
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={props.ownStatus === option.value}
              onClick={() => {
                props.onSetStatus(option.value);
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left text-[13px] text-text hover:bg-surface-3"
            >
              <StatusDot status={option.value} />
              <span className="flex-1">{option.label}</span>
              {props.ownStatus === option.value && (
                <Icon name="check" size={14} className="text-accent" />
              )}
            </button>
          ))}
          <div className="my-1 h-px bg-border" />
          {editingStatus ? (
            <div className="px-1 py-0.5">
              <input
                ref={statusInputRef}
                aria-label="Custom status"
                value={statusDraft}
                maxLength={80}
                placeholder="Set a custom status…"
                onChange={(event) => setStatusDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    saveCustomStatus();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setEditingStatus(false);
                  }
                }}
                onBlur={saveCustomStatus}
                className="h-8 w-full rounded-[7px] border border-border bg-surface-3 px-2 text-[13px] text-text transition placeholder:text-text-muted focus:border-accent focus:outline-none"
              />
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setStatusDraft(customStatusText);
                setEditingStatus(true);
              }}
              className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left text-[13px] text-text transition hover:bg-surface-3"
            >
              <Icon name="pencil" size={14} className="text-text-muted" />
              <span
                className={cn("min-w-0 flex-1 truncate", !hasCustomStatus && "text-text-muted")}
              >
                {hasCustomStatus ? customStatusText : "Set a custom status…"}
              </span>
              {hasCustomStatus && <Icon name="check" size={14} className="shrink-0 text-accent" />}
            </button>
          )}
        </div>
      )}
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Set your status"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left transition hover:bg-surface-3"
        >
          <PresenceAvatar userId={props.ownUserId} size={30} status={props.ownStatus} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-text">
              {props.ownName}
            </span>
            <span className="block truncate text-[11px] text-text-muted">{statusLabel}</span>
          </span>
        </button>
        {props.onOpenUserSettings !== undefined && (
          <HeaderButton
            label={props.appUpdateAvailable ? "User settings (update available)" : "User settings"}
            onClick={props.onOpenUserSettings}
          >
            <span className="relative inline-flex">
              <Icon name="settings" size={17} />
              {props.appUpdateAvailable && (
                <span
                  className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent ring-2 ring-surface-1"
                  role="img"
                  aria-label="Update available"
                />
              )}
            </span>
          </HeaderButton>
        )}
        <HeaderButton label="Sign out" onClick={() => setConfirmSignOut(true)}>
          <Icon name="logout" size={17} />
        </HeaderButton>
      </div>

      <ConfirmDialog
        open={confirmSignOut}
        onClose={() => setConfirmSignOut(false)}
        title={`Sign out of ${props.workspaceName}?`}
        description="You can sign back in at any time."
        confirmLabel="Sign out"
        variant="danger"
        onConfirm={() => {
          setConfirmSignOut(false);
          props.onSignOut();
        }}
      />
    </div>
  );
}

export function StatusDot({ status }: { readonly status: PresenceStatus }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "h-2.5 w-2.5 rounded-full",
        status === "online" && "bg-secondary",
        status === "idle" && "bg-idle",
        status === "dnd" && "bg-danger",
        status === "offline" && "border-2 border-text-muted",
      )}
    />
  );
}
