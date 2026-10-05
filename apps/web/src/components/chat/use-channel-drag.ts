import type { ChannelView } from "@aulora/core";
import { useRef, useState } from "react";

export interface ChannelGroupKey {
  readonly key: string;
  readonly channels: readonly ChannelView[];
}

interface DragState {
  readonly dragChannelId: string | null;
  readonly dropTarget: { groupKey: string; index: number } | null;
}

export interface ChannelDrag {
  readonly dragChannelId: string | null;
  readonly dropTarget: { groupKey: string; index: number } | null;
  readonly selectChannel: (channelId: string) => void;
  readonly startDrag: (channelId: string) => void;
  readonly endDrag: () => void;
  readonly dragOverList: (event: React.DragEvent, groupKey: string) => void;
  readonly dropOnList: (groupKey: string) => void;
  readonly dragLeaveList: (event: React.DragEvent, groupKey: string) => void;
}

interface ChannelDragOptions {
  readonly channels: readonly ChannelView[];
  readonly groups: readonly ChannelGroupKey[];
  readonly knownCategoryIds: ReadonlySet<string>;
  readonly canReorder: boolean;
  readonly onSelect: (channelId: string) => void;
  readonly onReorderChannels:
    | ((
        moves: readonly {
          readonly channelId: string;
          readonly categoryId: string | null;
          readonly position: number;
        }[],
      ) => void)
    | undefined;
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

/** Drag-and-drop reordering of channels between and within sidebar groups. */
export function useChannelDrag(options: ChannelDragOptions): ChannelDrag {
  const [state, setState] = useState<DragState>({ dragChannelId: null, dropTarget: null });
  const draggingRef = useRef(false);
  const { channels, groups, knownCategoryIds, canReorder, onSelect, onReorderChannels } = options;

  const clearDrag = () => {
    setState({ dragChannelId: null, dropTarget: null });
  };

  const startDrag = (channelId: string) => {
    draggingRef.current = true;
    setState((current) => ({ ...current, dragChannelId: channelId }));
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
    if (!canReorder || state.dragChannelId === null) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rows = [
      ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[data-drag-index]"),
    ];
    let index = rows.length;
    for (const [i, row] of rows.entries()) {
      const rect = row.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        index = i;
        break;
      }
    }
    setState((current) =>
      current.dropTarget !== null &&
      current.dropTarget.groupKey === groupKey &&
      current.dropTarget.index === index
        ? current
        : { ...current, dropTarget: { groupKey, index } },
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
    const { dragChannelId, dropTarget } = state;
    clearDrag();
    if (dragChannelId === null || dropTarget === null || onReorderChannels === undefined) {
      return;
    }
    const targetGroup = groups.find((group) => group.key === groupKey);
    const dragged = channels.find((channel) => channel.id === dragChannelId);
    if (targetGroup === undefined || dragged === undefined) {
      return;
    }

    const rendered = targetGroup.channels;
    const sourceIndex = rendered.findIndex((channel) => channel.id === dragChannelId);
    let reducedIndex = dropTarget.index;
    if (sourceIndex !== -1 && sourceIndex < dropTarget.index) {
      reducedIndex -= 1;
    }
    const targetList = rendered.filter((channel) => channel.id !== dragChannelId);
    targetList.splice(
      Math.max(0, Math.min(reducedIndex, targetList.length)),
      0,
      dragged as ChannelView,
    );

    const sourceKey = groupKeyOf(dragged, knownCategoryIds);
    if (sourceKey === targetGroup.key) {
      const unchanged = targetList.every((channel, index) => channel.id === rendered.at(index)?.id);
      if (unchanged) {
        return;
      }
      onReorderChannels(movesForGroup(targetGroup.key, targetList));
      return;
    }

    // Cross-category: re-index the source group so its remaining order sticks.
    const sourceGroup = groups.find((group) => group.key === sourceKey);
    const sourceList =
      sourceGroup === undefined
        ? []
        : sourceGroup.channels.filter((channel) => channel.id !== dragChannelId);
    onReorderChannels([
      ...movesForGroup(targetGroup.key, targetList),
      ...movesForGroup(sourceKey, sourceList),
    ]);
  };

  const dragLeaveList = (event: React.DragEvent, groupKey: string) => {
    const next = event.relatedTarget as Node | null;
    if (next !== null && (event.currentTarget as HTMLElement).contains(next)) {
      return;
    }
    setState((current) =>
      current.dropTarget?.groupKey === groupKey ? { ...current, dropTarget: null } : current,
    );
  };

  return {
    dragChannelId: state.dragChannelId,
    dropTarget: state.dropTarget,
    selectChannel,
    startDrag,
    endDrag,
    dragOverList,
    dropOnList,
    dragLeaveList,
  };
}
