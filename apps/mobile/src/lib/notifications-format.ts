/**
 * Pure notification decisions for mobile. Local display only: the server never
 * pushes message text, so this device decides whether an incoming message
 * should raise an OS notification. Kept free of `expo-notifications` imports so
 * it is unit-testable on any host.
 */

export interface NotificationContent {
  readonly title: string;
  readonly body: string;
}

/** How much message text a notification may carry. */
export const NOTIFICATION_BODY_LIMIT = 240;

/** Formats the local notification for one message. */
export function notificationContent(
  channelName: string | undefined,
  text: string,
  options: { readonly limit?: number; readonly mention?: boolean } = {},
): NotificationContent {
  const limit = options.limit ?? NOTIFICATION_BODY_LIMIT;
  const trimmed = text.trim();
  const base = channelName === undefined ? "New message" : `#${channelName}`;
  return {
    title: options.mention === true ? `Mention in ${base}` : base,
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
 * replay history), and carrying non-empty text.
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
