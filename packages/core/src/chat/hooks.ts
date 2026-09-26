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

/** Decrypts channel names/topics from the session and returns display views. */
export async function toChannelViews(
  session: ChatSession,
  channels: readonly ChannelSummary[],
): Promise<ChannelView[]> {
  const views: ChannelView[] = [];
  for (const channel of channels) {
    views.push({ ...channel, name: channelName(channel, session) });
  }
  return views;
}

/** Best-effort display name for a channel: decrypted name or a placeholder. */
export function channelName(channel: ChannelSummary, session?: ChatSession): string {
  if (channel.nameCiphertext !== null && session !== undefined) {
    const decoded = session.decryptedText(`channel-name:${channel.id}`);
    if (decoded !== undefined) {
      return decoded;
    }
  }
  if (channel.kind === "dm") {
    return "Direct message";
  }
  if (channel.kind === "group_dm") {
    return "Group message";
  }
  return channel.archived ? "archived" : "channel";
}
