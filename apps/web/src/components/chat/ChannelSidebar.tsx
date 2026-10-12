/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Avatar } from "@aulora/avatars";
import type { ChannelView } from "@aulora/core";
import { partitionPinnedDms } from "@aulora/core";
import { cn, Icon, useContextMenu } from "@aulora/ui-web";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { CategoryView } from "../../lib/workspace-admin";
import { VoiceChannelRow } from "../voice/VoiceChannelRow";
import {
  AccountFooter,
  CreateMenuButton,
  HeaderButton,
  SectionHeader,
} from "./ChannelSidebarChrome";
import { CategoryDropLine, ChannelRow, DmRow, DropLine } from "./ChannelSidebarRows";
import {
  buildChannelGroups,
  type ChannelSidebarProps,
  COLLAPSED_KEY,
  readCollapsed,
} from "./channel-sidebar-model";
import { categoryMenuItems, channelMenuItems } from "./sidebar-menus";
import { useCategoryDrag } from "./use-category-drag";
import { useChannelDrag } from "./use-channel-drag";

export { STATUS_OPTIONS, StatusDot } from "./ChannelSidebarChrome";
export type { ChannelSidebarProps, ChannelUnread } from "./channel-sidebar-model";

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

  useEffect(() => {
    try {
      globalThis.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
    } catch {
      // Collapse state is a nicety; ignore storage failures.
    }
  }, [collapsed]);

  const toggle = (key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const groups = useMemo(() => buildChannelGroups(channels, categories), [channels, categories]);

  const knownCategoryIds = useMemo(
    () => new Set(categories.map((category) => category.id)),
    [categories],
  );

  const canReorder = props.canReorderChannels === true && props.onReorderChannels !== undefined;

  const {
    dragChannelId,
    dropTarget,
    selectChannel,
    startDrag,
    endDrag,
    dragOverList,
    dropOnList,
    dragLeaveList,
  } = useChannelDrag({
    channels,
    groups,
    knownCategoryIds,
    canReorder,
    onSelect,
    onReorderChannels: props.onReorderChannels,
  });

  const canReorderCategories =
    props.canReorderCategories === true && props.onReorderCategories !== undefined;

  const { headerDrag, isDragging: isCategoryDragging } = useCategoryDrag({
    categories,
    canReorder: canReorderCategories,
    onReorderCategories: props.onReorderCategories,
  });

  const hiddenChannels = useMemo(
    () => channels.filter((channel) => channel.hidden === true),
    [channels],
  );

  const { pinned: pinnedDms, others: dms } = useMemo(() => {
    const direct = channels
      .filter(
        (channel) =>
          (channel.kind === "dm" || channel.kind === "group_dm") && channel.hidden !== true,
      )
      .sort(
        (a, b) =>
          (unreadByChannel.get(b.id)?.lastActivityAt ?? 0) -
          (unreadByChannel.get(a.id)?.lastActivityAt ?? 0),
      );
    return partitionPinnedDms(direct);
  }, [channels, unreadByChannel]);

  const channelMenu = (channel: ChannelView, active: boolean) =>
    channelMenuItems(channel, active, props.channelActions);

  const categoryMenu = (category: CategoryView) =>
    categoryMenuItems(category, props.categoryActions);

  const openConversationMenu = (channel: ChannelView, event: React.MouseEvent) => {
    const items = channelMenu(channel, channel.id === activeChannelId);
    if (items.length === 0) {
      return;
    }
    openMenu({
      clientX: event.clientX,
      clientY: event.clientY,
      items,
      label: props.titles.get(channel.id) ?? channel.name,
    });
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
      {props.onOpenNotes && (
        <div className="px-3 pb-2">
          <button
            type="button"
            data-testid="sidebar-notes"
            aria-current={props.mainView === "notes" ? "page" : undefined}
            onClick={props.onOpenNotes}
            className={cn(
              "flex h-8 w-full items-center gap-2.5 rounded-[8px] pl-3 pr-2 text-left text-[13px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              props.mainView === "notes"
                ? "bg-surface-3 font-semibold text-text"
                : "text-text-muted hover:bg-surface-3 hover:text-text",
            )}
          >
            <Icon name="note" size={16} />
            <span>Notes</span>
          </button>
        </div>
      )}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.map((group) => {
          const category = group.category;
          const categoryDrag =
            category !== undefined && canReorderCategories ? headerDrag(category.id) : undefined;
          return (
            <section key={group.key} className="mt-2">
              {categoryDrag?.dropPlacement === "before" && <CategoryDropLine />}
              <SectionHeader
                title={group.name}
                collapsed={collapsed.has(group.key)}
                onToggle={() => {
                  if (categoryDrag === undefined || !isCategoryDragging()) {
                    toggle(group.key);
                  }
                }}
                {...(categoryDrag !== undefined ? { drag: categoryDrag } : {})}
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
              {categoryDrag?.dropPlacement === "after" && <CategoryDropLine />}
              {!collapsed.has(group.key) && (
                <ul
                  className="flex flex-col gap-px"
                  {...(canReorder
                    ? {
                        onDragOver: (event: React.DragEvent) => {
                          dragOverList(event, group.key);
                        },
                        onDragLeave: (event: React.DragEvent) => {
                          dragLeaveList(event, group.key);
                        },
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
                            {...(canReorder
                              ? {
                                  drag: {
                                    dragIndex: index,
                                    dragging: dragChannelId === channel.id,
                                    onDragStart: () => {
                                      startDrag(channel.id);
                                    },
                                    onDragEnd: endDrag,
                                  },
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
            onToggle={() => {
              toggle("dms");
            }}
            action={
              <HeaderButton label="New direct message" small onClick={props.onNewConversation}>
                <Icon name="compose" size={14} />
              </HeaderButton>
            }
          />
          {!collapsed.has("dms") && (
            <ul className="flex flex-col gap-px">
              {pinnedDms.length > 0 && (
                <li className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                  Pinned
                </li>
              )}
              {[...pinnedDms, ...dms].map((channel) => (
                <li key={channel.id}>
                  <DmRow
                    channel={channel}
                    title={props.titles.get(channel.id) ?? channel.name}
                    ownUserId={props.ownUserId}
                    presenceOf={props.presenceOf}
                    active={channel.id === activeChannelId}
                    unread={unreadByChannel.get(channel.id)}
                    onSelect={onSelect}
                    onContextMenu={(event) => {
                      openConversationMenu(channel, event);
                    }}
                  />
                </li>
              ))}
              {pinnedDms.length === 0 && dms.length === 0 && (
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
              onToggle={() => {
                toggle("hidden");
              }}
              action={null}
            />
            {!collapsed.has("hidden") && (
              <ul className="flex flex-col gap-px">
                {hiddenChannels.map((channel) => (
                  <li key={channel.id} className="flex items-center gap-px">
                    <button
                      type="button"
                      data-testid={`hidden-channel-row-${channel.id}`}
                      onClick={() => {
                        onSelect(channel.id);
                      }}
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
