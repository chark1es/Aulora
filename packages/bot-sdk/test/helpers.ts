import type { BotEvent, BotEventMessage, BotEventType } from "../src/types.js";

const DEFAULTS: BotEventMessage = {
  id: "msg_1",
  channelId: "chan_1",
  authorId: "user_1",
  body: "hello",
  threadRootId: null,
  replyToId: null,
  attachmentIds: [],
  mentionUserIds: [],
  editedAt: null,
  deletedAt: null,
  createdAt: 1_700_000_000_000,
};

export function message(overrides: Partial<BotEventMessage> = {}): BotEventMessage {
  return { ...DEFAULTS, ...overrides };
}

export function event(
  type: BotEventType,
  overrides: Partial<Omit<BotEvent, "type">> = {},
): BotEvent {
  return {
    seq: 1,
    type,
    channelId: "chan_1",
    message: type.startsWith("message.") ? message() : null,
    reaction: type.startsWith("reaction.")
      ? { messageId: "msg_1", userId: "user_2", emoji: "👍" }
      : null,
    self: false,
    ...overrides,
  };
}

export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
  label = "condition",
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Convex's HTTP JSON encoding for int64, using the same little-endian base64. */
export function int64(value: bigint): { $integer: string } {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64LE(value);
  return { $integer: buffer.toString("base64") };
}
