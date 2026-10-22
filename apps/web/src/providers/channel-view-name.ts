import type { ChannelSummary } from "@aulora/core";

/** The label for a channel whose name is not known at all. */
export function placeholderName(channel: ChannelSummary): string {
  if (channel.kind === "dm") {
    return "Direct message";
  }
  if (channel.kind === "group_dm") {
    return "Group message";
  }
  return channel.archived ? "archived" : "channel";
}

/**
 * The name a channel is shown under: a cached name first (it carries live
 * renames), then the name the server sent with the channel, and a placeholder
 * only when neither exists. Skipping the server's name made the channel that
 * is active on load render as "channel" before the cache filled, and the chat
 * view echoed that placeholder back into the cache, where it stuck.
 */
export function channelViewName(
  channel: ChannelSummary,
  knownNames: ReadonlyMap<string, string>,
): string {
  const cached = knownNames.get(channel.id);
  if (cached !== undefined) {
    return cached;
  }
  const sent = channel.name;
  return sent !== null && sent !== undefined && sent.length > 0 ? sent : placeholderName(channel);
}
