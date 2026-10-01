import type { ChatSession, OutboxItem } from "@aulora/core";

/** Preserve reply targets, mentions and already-uploaded files when retrying. */
export async function sendOutboxItem(session: ChatSession, item: OutboxItem): Promise<void> {
  await session.sendMessage(item.channelId, item.text, {
    mentionUserIds: item.mentionUserIds,
    ...(item.mentionChannelIds !== undefined ? { mentionChannelIds: item.mentionChannelIds } : {}),
    ...(item.mentionCategoryIds !== undefined
      ? { mentionCategoryIds: item.mentionCategoryIds }
      : {}),
    ...(item.threadRootId !== undefined ? { threadRootId: item.threadRootId } : {}),
    ...(item.replyToId !== undefined ? { replyToId: item.replyToId } : {}),
    ...(item.attachments !== undefined
      ? { attachmentIds: item.attachments.map((file) => file.fileId) }
      : {}),
  });
}
