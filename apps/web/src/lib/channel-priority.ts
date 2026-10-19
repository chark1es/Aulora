import type { ChannelSummary } from "@aulora/core";

/** The sidebar's per-channel unread state, structurally (no component import). */
export interface ChannelUnreadState {
  readonly unread: boolean;
  readonly mentionCount: number;
  readonly lastActivityAt: number | null;
}

/**
 * How many channels the web client keeps live in the background. The open
 * conversation is always served by `useChannelSession`; this set is only the
 * extra conversations whose message streams stay warm so background alerts
 * (chime / OS notification) keep working without opening every channel.
 */
export const EAGER_CHANNEL_OPEN_CAP = 8;

/**
 * Picks the bounded set of channels to keep subscribed eagerly: the
 * conversations the sidebar highlights as unread or mentioning the viewer,
 * most recent activity first, then a small fill of the first ordinary
 * conversations so a quiet workspace still keeps a couple of streams warm.
 *
 * The result is always at most `cap` ids, so signing in never fans out to every
 * conversation. The active channel is handled separately by its own session
 * hook, so it does not need to be in this set.
 */
export function selectEagerChannelIds(
  channels: readonly Pick<ChannelSummary, "id" | "kind" | "archived" | "hidden">[],
  unread: ReadonlyMap<string, ChannelUnreadState>,
  cap: number = EAGER_CHANNEL_OPEN_CAP,
): readonly string[] {
  const openable = channels.filter((channel) => !channel.archived && channel.hidden !== true);
  const highlighted = openable
    .filter((channel) => {
      const state = unread.get(channel.id);
      return state !== undefined && (state.unread || state.mentionCount > 0);
    })
    .sort(
      (a, b) => (unread.get(b.id)?.lastActivityAt ?? 0) - (unread.get(a.id)?.lastActivityAt ?? 0),
    );

  const ids = new Set<string>();
  for (const channel of highlighted) {
    if (ids.size >= cap) {
      break;
    }
    ids.add(channel.id);
  }
  if (ids.size < cap) {
    for (const channel of openable) {
      if (ids.size >= cap) {
        break;
      }
      ids.add(channel.id);
    }
  }
  return [...ids];
}
