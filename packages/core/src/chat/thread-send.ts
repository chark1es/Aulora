/** A channel-copy failure must not make an accepted thread reply retryable. */
export async function sendThreadReply(
  sendReply: () => Promise<unknown>,
  sendChannelCopy: (() => Promise<unknown>) | undefined,
  onCopyError: (error: unknown) => void,
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
