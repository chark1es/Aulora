import type { Fn } from "../function-type";

/** A channel-copy failure must not make an accepted thread reply retryable. */
export async function sendThreadReply(
  sendReply: () => Promise<unknown>,
  sendChannelCopy: (() => Promise<unknown>) | undefined,
  onCopyError: Fn<[error: unknown], void>,
): Promise<void> {
  await sendReply();
  if (sendChannelCopy !== undefined) {
    try {
      await sendChannelCopy();
    } catch (error) {
      onCopyError(error);
    }
  }
}
