import type { ChannelView } from "@aulora/core";
import type { ChatRuntime } from "../../lib/chat-runtime";
import type { ChannelUnread } from "./ChannelSidebar";

/** Per-channel bookkeeping for restoring channels that receive a mention. */
export interface RestoreTracking {
  readonly restoring: Set<string>;
  readonly baseline: Map<string, number>;
}

/**
 * Restores any hidden channel that has picked up new mentions back into its
 * category. Tracks the mention count seen when a channel was hidden and the
 * channels already being restored so a single burst only restores once.
 */
export function restoreMentionedChannels(
  tracking: RestoreTracking,
  runtime: ChatRuntime | undefined,
  channels: readonly ChannelView[],
  unreadByChannel: ReadonlyMap<string, ChannelUnread>,
): void {
  const port = runtime?.port;
  if (port?.setChannelHidden === undefined) {
    return;
  }
  for (const channel of channels) {
    if (channel.hidden !== true) {
      tracking.restoring.delete(channel.id);
      tracking.baseline.delete(channel.id);
      continue;
    }
    const mentionCount = unreadByChannel.get(channel.id)?.mentionCount ?? 0;
    const seen = tracking.baseline.get(channel.id) ?? 0;
    if (mentionCount < seen) {
      tracking.baseline.set(channel.id, mentionCount);
    }
    if (
      mentionCount <= (tracking.baseline.get(channel.id) ?? 0) ||
      tracking.restoring.has(channel.id)
    ) {
      continue;
    }
    tracking.restoring.add(channel.id);
    void port.setChannelHidden({ channelId: channel.id, hidden: false }).catch(() => {
      tracking.restoring.delete(channel.id);
    });
  }
}
