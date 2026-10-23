import { type ChannelSummary, WEBHOOK_LIMITS } from "@aulora/core";

/** Channels a webhook can post into: live text and announcement channels. */
export function postableChannels(channels: readonly ChannelSummary[]): ChannelSummary[] {
  return channels.filter(
    (channel) => (channel.kind === "text" || channel.kind === "announcement") && !channel.archived,
  );
}

/** The name as shown in lists; falls back to a neutral label for a missing channel. */
export function webhookChannelLabel(
  channelId: string,
  channels: readonly ChannelSummary[],
  channelNames: ReadonlyMap<string, string> | undefined,
): string {
  const name = channelNames?.get(channelId) ?? channels.find((c) => c.id === channelId)?.name;
  return name === null || name === undefined ? "Unknown channel" : `#${name}`;
}

/** Mirrors the server check so a mistake is caught before a round trip. */
export function validateWebhookName(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0) {
    return "Give the webhook a name.";
  }
  if (name.length > WEBHOOK_LIMITS.maxNameLength) {
    return `Names can be at most ${WEBHOOK_LIMITS.maxNameLength} characters.`;
  }
  return null;
}

/** "Never used", "Used just now", "Used 3 days ago". */
export function describeLastUsed(lastUsedAt: number | null, now: number): string {
  if (lastUsedAt === null) {
    return "Never used";
  }
  const minutes = Math.floor((now - lastUsedAt) / 60_000);
  if (minutes < 1) {
    return "Used just now";
  }
  if (minutes < 60) {
    return `Used ${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Used ${hours} h ago`;
  }
  return `Used ${Math.floor(hours / 24)} d ago`;
}
