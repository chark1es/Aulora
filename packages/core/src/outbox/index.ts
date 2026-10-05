/**
 * Offline outbox.
 *
 * Sends attempted while offline (or that fail) are persisted as plaintext
 * items in a {@link OutboxStore} (IndexedDB on web). Plaintext lives only on
 * the device; nothing is transmitted until {@link Outbox.flush} hands an item
 * back to the caller, which sends it through the chat port. Retries use
 * exponential backoff.
 */

import type { AttachmentDescriptor } from "../chat/port.js";

export type OutboxStatus = "pending" | "sending" | "failed";

/**
 * Substrings that mark an error as a connectivity failure rather than a server
 * rejection. A fetch/WebSocket failure or an offline browser should queue the
 * send; a validation or permission error should surface to the caller.
 */
const CONNECTIVITY_PATTERNS = [
  "failed to fetch",
  "fetch failed",
  "networkerror",
  "network error",
  "network request failed",
  "network connection",
  "connection lost",
  "connection error",
  "load failed",
  "websocket",
  "socket",
  "offline",
  "chat is not ready",
  "not connected",
  "disconnected",
  "temporarily unavailable",
  "service unavailable",
  "timed out",
  "timeout",
  "econnrefused",
  "econnreset",
  "err_internet",
  "internet",
  "unreachable",
] as const;

/**
 * Whether `error` looks like a connectivity failure (network/fetch/WebSocket
 * error, or the browser reporting offline) rather than a server-side rejection.
 * Used to decide between queueing a send and surfacing an error.
 */
export function isConnectivityError(error: unknown): boolean {
  const online: unknown = typeof navigator === "undefined" ? undefined : navigator.onLine;
  if (online === false) {
    return true;
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error === null || error === undefined
          ? ""
          : String(error);
  const haystack = message.toLowerCase();
  if (haystack.length === 0) {
    return false;
  }
  return CONNECTIVITY_PATTERNS.some((pattern) => haystack.includes(pattern));
}

/** One queued send. Plaintext is device-local until flushed. */
export interface OutboxItem {
  readonly id: string;
  readonly channelId: string;
  readonly text: string;
  readonly mentionUserIds: readonly string[];
  readonly mentionChannelIds?: readonly string[];
  readonly mentionCategoryIds?: readonly string[];
  readonly threadRootId?: string;
  readonly replyToId?: string;
  readonly attachments?: readonly AttachmentDescriptor[];
  readonly createdAt: number;
  readonly attempts: number;
  readonly lastAttemptAt?: number;
  /** Earliest time (ms epoch) this item may be retried. */
  readonly nextAttemptAt: number;
  readonly status: OutboxStatus;
}

/** Durable storage for queued sends. */
export interface OutboxStore {
  readAll(): Promise<readonly OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  delete(id: string): Promise<void>;
}

/** In-memory {@link OutboxStore} for tests and non-browser hosts. */
export function memoryOutboxStore(seed: readonly OutboxItem[] = []): OutboxStore {
  const items = new Map<string, OutboxItem>();
  for (const item of seed) {
    items.set(item.id, item);
  }
  return {
    readAll() {
      return Promise.resolve([...items.values()]);
    },
    put(item) {
      items.set(item.id, item);
      return Promise.resolve();
    },
    delete(id) {
      items.delete(id);
      return Promise.resolve();
    },
  };
}

export interface EnqueueInput {
  readonly channelId: string;
  readonly text: string;
  readonly mentionUserIds?: readonly string[];
  readonly mentionChannelIds?: readonly string[];
  readonly mentionCategoryIds?: readonly string[];
  readonly threadRootId?: string;
  readonly replyToId?: string;
  readonly attachments?: readonly AttachmentDescriptor[];
}

export interface FlushOptions {
  /** Current time in ms; defaults to `Date.now`. Injectable for tests. */
  readonly now?: () => number;
  /** Attempts before an item is marked failed. Defaults to 5. */
  readonly maxAttempts?: number;
  /** Base backoff delay. Defaults to 1000 ms. */
  readonly baseDelayMs?: number;
  /** Backoff ceiling. Defaults to 60_000 ms. */
  readonly maxDelayMs?: number;
}

export interface FlushResult {
  readonly sent: readonly string[];
  readonly retried: readonly string[];
  readonly failed: readonly string[];
}

export interface OutboxOptions {
  readonly store?: OutboxStore;
  /** Id factory; defaults to `crypto.randomUUID` with a fallback. */
  readonly createId?: () => string;
}

let fallbackId = 0;

function defaultId(): string {
  const uuid = (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID;
  if (typeof uuid === "function") {
    return globalThis.crypto.randomUUID();
  }
  fallbackId += 1;
  return `outbox-${Date.now().toString(36)}-${fallbackId}`;
}

/** Queues, lists and flushes offline sends. */
export class Outbox {
  private readonly store: OutboxStore;
  private readonly createId: () => string;
  private flushing = false;

  constructor(options: OutboxOptions = {}) {
    this.store = options.store ?? memoryOutboxStore();
    this.createId = options.createId ?? defaultId;
  }

  /** Persists a new queued send and returns it. */
  async enqueue(input: EnqueueInput, now: number = Date.now()): Promise<OutboxItem> {
    const item: OutboxItem = {
      id: this.createId(),
      channelId: input.channelId,
      text: input.text,
      mentionUserIds: [...(input.mentionUserIds ?? [])],
      ...(input.mentionChannelIds !== undefined
        ? { mentionChannelIds: [...input.mentionChannelIds] }
        : {}),
      ...(input.mentionCategoryIds !== undefined
        ? { mentionCategoryIds: [...input.mentionCategoryIds] }
        : {}),
      ...(input.threadRootId !== undefined ? { threadRootId: input.threadRootId } : {}),
      ...(input.replyToId !== undefined ? { replyToId: input.replyToId } : {}),
      ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
      createdAt: now,
      attempts: 0,
      nextAttemptAt: now,
      status: "pending",
    };
    await this.store.put(item);
    return item;
  }

  /** All queued items, oldest first. */
  async list(): Promise<readonly OutboxItem[]> {
    const items = await this.store.readAll();
    return [...items].sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Number of queued items that are not permanently failed. */
  async pendingCount(): Promise<number> {
    return (await this.store.readAll()).filter((item) => item.status !== "failed").length;
  }

  async remove(id: string): Promise<void> {
    await this.store.delete(id);
  }

  /**
   * Resets a queued item (including a permanently `failed` one) so it is due
   * for another send: clears its attempt count and returns it to `pending`.
   * Returns `undefined` when no item has that id.
   */
  async retry(id: string, now: number = Date.now()): Promise<OutboxItem | undefined> {
    const items = await this.store.readAll();
    const item = items.find((entry) => entry.id === id);
    if (item === undefined) {
      return undefined;
    }
    const next: OutboxItem = {
      ...item,
      attempts: 0,
      status: "pending",
      nextAttemptAt: now,
    };
    await this.store.put(next);
    return next;
  }

  /** Items eligible to send at `now`, oldest first. */
  async due(now: number = Date.now()): Promise<readonly OutboxItem[]> {
    const items = await this.store.readAll();
    return items
      .filter((item) => item.status === "pending" && item.nextAttemptAt <= now)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Attempts every due item through `send` (which encrypts and transmits).
   * Success removes the item; failure backs it off, then marks it failed once
   * `maxAttempts` is reached. Re-entrant calls are ignored so concurrent
   * online events never double-send.
   */
  async flush(
    send: (item: OutboxItem) => Promise<void>,
    options: FlushOptions = {},
  ): Promise<FlushResult> {
    if (this.flushing) {
      return { sent: [], retried: [], failed: [] };
    }
    this.flushing = true;
    const now = options.now?.() ?? Date.now();
    const maxAttempts = options.maxAttempts ?? 5;
    const baseDelayMs = options.baseDelayMs ?? 1_000;
    const maxDelayMs = options.maxDelayMs ?? 60_000;
    const sent: string[] = [];
    const retried: string[] = [];
    const failed: string[] = [];
    try {
      for (const item of await this.due(now)) {
        try {
          await send(item);
          await this.store.delete(item.id);
          sent.push(item.id);
        } catch {
          const attempts = item.attempts + 1;
          if (attempts >= maxAttempts) {
            await this.store.put({
              ...item,
              attempts,
              status: "failed",
              lastAttemptAt: now,
            });
            failed.push(item.id);
          } else {
            const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempts - 1));
            await this.store.put({
              ...item,
              attempts,
              status: "pending",
              lastAttemptAt: now,
              nextAttemptAt: now + delay,
            });
            retried.push(item.id);
          }
        }
      }
      return { sent, retried, failed };
    } finally {
      this.flushing = false;
    }
  }
}
