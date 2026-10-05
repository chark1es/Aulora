import type { ChannelView } from "@aulora/core";
import { type ContextMenuItem, Icon } from "@aulora/ui-web";
import type { CategoryView } from "../../lib/workspace-admin";

/** Channel context-menu actions; absent entries are hidden. */
export interface ChannelActions {
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
}

/** Category context-menu actions; absent entries are hidden. */
export interface CategoryActions {
  readonly rename?: (category: CategoryView) => void;
  readonly delete?: (category: CategoryView) => void;
  readonly createChannel?: (category: CategoryView) => void;
}

/** Builds the channel context menu, in priority order, from the available actions. */
export function channelMenuItems(
  channel: ChannelView,
  active: boolean,
  actions: ChannelActions | undefined,
): ContextMenuItem[] {
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
}

/** Builds the category context menu from the available actions. */
export function categoryMenuItems(
  category: CategoryView,
  actions: CategoryActions | undefined,
): ContextMenuItem[] {
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
}
