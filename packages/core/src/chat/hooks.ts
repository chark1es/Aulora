/**
 * Framework-agnostic view helpers for the chat session.
 *
 * These are plain functions (not React hooks) so both the web app and the
 * native app can call them under whichever reactivity system they use. The web
 * app wraps them in `useSyncExternalStore`.
 */

import type { ChannelSummary, MessagePayload } from "./port.js";
import type { ChatSession } from "./session.js";

export interface ChannelView extends ChannelSummary {
  readonly name: string;
}

export interface UseChatSessionResult {
  readonly channels: readonly ChannelView[];
  readonly messages: readonly MessagePayload[];
  readonly decrypted: ReadonlyMap<string, string>;
}

/**
 * Groups messages into day buckets (UTC) for rendering day separators.
 * Returns `[dayStartMs, messages]` in ascending order.
 */
export function gridDays(
  messages: readonly MessagePayload[],
): readonly (readonly [number, readonly MessagePayload[]])[] {
  const days = new Map<number, MessagePayload[]>();
  for (const message of messages) {
    const day = startOfUtcDay(message.createdAt);
    const bucket = days.get(day);
    if (bucket === undefined) {
      days.set(day, [message]);
    } else {
      bucket.push(message);
    }
  }
  return [...days.entries()].sort((a, b) => a[0] - b[0]);
}

function startOfUtcDay(timestamp: number): number {
  return Date.UTC(
    new Date(timestamp).getUTCFullYear(),
    new Date(timestamp).getUTCMonth(),
    new Date(timestamp).getUTCDate(),
  );
}

/** Builds display views from plaintext channel summaries. */
export function toChannelViews(
  _session: ChatSession,
  channels: readonly ChannelSummary[],
): Promise<ChannelView[]> {
  void _session;
  return Promise.resolve(channels.map((channel) => ({ ...channel, name: channelName(channel) })));
}

/** Best-effort display name for a channel: its plaintext name or a placeholder. */
export function channelName(channel: ChannelSummary, _session?: ChatSession): string {
  void _session;
  if (channel.name !== null && channel.name.length > 0) {
    return channel.name;
  }
  if (channel.kind === "dm") {
    return "Direct message";
  }
  if (channel.kind === "group_dm") {
    return "Group message";
  }
  return channel.archived ? "archived" : "channel";
}
