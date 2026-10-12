/**
 * Ordering for the Direct messages list, shared by the web and native clients.
 *
 * A viewer's pinned conversations are lifted into their own block ahead of the
 * rest. Within the block the order is by `pinnedAt` ascending (the earliest pin
 * first), with the incoming index as a stable tie-break. Unpinned conversations
 * keep whatever order the caller supplied, which is most-recent-activity on
 * both clients.
 */
import type { ChannelSummary } from "./port.js";

export interface DmPinGroups<T> {
  readonly pinned: readonly T[];
  readonly others: readonly T[];
}

/** Splits a list of direct conversations into the pinned block and the rest. */
export function partitionPinnedDms<T extends ChannelSummary>(
  channels: readonly T[],
): DmPinGroups<T> {
  const pinned: { channel: T; index: number }[] = [];
  const others: T[] = [];
  channels.forEach((channel, index) => {
    if (channel.pinned === true) {
      pinned.push({ channel, index });
    } else {
      others.push(channel);
    }
  });
  pinned.sort((a, b) => (a.channel.pinnedAt ?? 0) - (b.channel.pinnedAt ?? 0) || a.index - b.index);
  return { pinned: pinned.map((entry) => entry.channel), others };
}
