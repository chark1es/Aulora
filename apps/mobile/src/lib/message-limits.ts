import { MESSAGE_MAX_ATTACHMENTS, MESSAGE_MAX_LENGTH } from "@aulora/core";

export { MESSAGE_MAX_ATTACHMENTS, MESSAGE_MAX_LENGTH };

/** A human-readable limit failure, or `null` when the message may be sent. */
export function messageLimitError(text: string, attachmentCount: number): string | null {
  if (text.length > MESSAGE_MAX_LENGTH) {
    return "Message is over 4,000 characters. Trim it or split it.";
  }
  if (attachmentCount > MESSAGE_MAX_ATTACHMENTS) {
    return `You can attach at most ${MESSAGE_MAX_ATTACHMENTS} files.`;
  }
  return null;
}

/** How many more files may be attached to the current message. */
export function attachmentRoom(currentCount: number): number {
  return Math.max(0, MESSAGE_MAX_ATTACHMENTS - Math.max(0, currentCount));
}
