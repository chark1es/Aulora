/**
 * Pure notification decisions for mobile. Local display only: the server never
 * sends message text (it only has ciphertext), so this device decides whether an
 * incoming decrypted message should raise an OS notification. Kept free of
 * `expo-notifications` imports so it is unit-testable on any host.
 */

export interface NotificationContent {
  readonly title: string;
  readonly body: string;
}

/** How much decrypted text a notification may carry. */
export const NOTIFICATION_BODY_LIMIT = 240;

/** Formats the local notification for one decrypted message. */
export function notificationContent(
  channelName: string | undefined,
  text: string,
  limit: number = NOTIFICATION_BODY_LIMIT,
): NotificationContent {
  const trimmed = text.trim();
  return {
    title: channelName === undefined ? "New message" : `#${channelName}`,
    body: trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed,
  };
}

export interface NotifiableMessage {
  readonly id: string;
  readonly authorId: string;
  readonly createdAt: number;
  readonly text: string | undefined;
}

/**
 * Decides whether one incoming message should raise a notification: not authored
 * by this device, created after the app mounted (so opening the app does not
 * replay history), and carrying non-empty decrypted text.
 */
export function shouldNotify(
  message: NotifiableMessage,
  ownUserId: string,
  mountedAt: number,
): boolean {
  if (message.authorId === ownUserId) {
    return false;
  }
  if (message.createdAt < mountedAt) {
    return false;
  }
  return message.text !== undefined && message.text.trim().length > 0;
}
