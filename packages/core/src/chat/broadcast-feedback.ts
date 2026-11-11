/** A successful legacy send can retain the text while losing its @here notification. */
export const BROADCAST_FALLBACK_NOTE =
  "Message sent. This server does not support @here notifications, so @here was sent as plain text.";
const listeners = new Set<(channelId: string) => void>();
export function reportBroadcastFallback(channelId: string): void {
  for (const listener of listeners) listener(channelId);
}
export function onBroadcastFallback(listener: (channelId: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Keep direct/role cues when broadcasts are suppressed. Old summaries have no split. */
export function summaryMentionIncreased(
  now: { mentionCount: number; massMentionCount?: number },
  before: { mentionCount: number; massMentionCount?: number } | undefined,
  suppressMassMentions: boolean,
): boolean {
  const count = (row: typeof now | undefined) =>
    row === undefined
      ? 0
      : suppressMassMentions
        ? Math.max(0, row.mentionCount - (row.massMentionCount ?? row.mentionCount))
        : row.mentionCount;
  return count(now) > count(before);
}
