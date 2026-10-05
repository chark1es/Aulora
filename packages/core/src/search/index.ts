/**
 * Local, on-device inverted search index over **decrypted** message text.
 *
 * The index never sends text anywhere: callers feed it plaintext that was
 * server-decrypted, and only ids and snippets come back. It is
 * persistent through a {@link SearchStore} adapter (IndexedDB on web, an
 * in-memory store in tests) and backfills from decrypted history in the
 * background via {@link SearchIndex.load}. {@link ArchiveBackfill} pages the
 * rest of the server archive into it, so a search covers every message the
 * viewer can read while the query itself stays on the device.
 */

import type { MessagePayload, Paginated } from "../chat/port.js";
import { isConnectivityError } from "../outbox/index.js";

/** One indexed, already-decrypted message. */
export interface SearchDocument {
  readonly messageId: string;
  readonly channelId: string;
  readonly authorId: string;
  readonly text: string;
  readonly createdAt: number;
  /** Set for thread replies, so a result can open the thread it belongs to. */
  readonly threadRootId?: string;
}

/** A ranked result with a context snippet. */
export interface SearchHit {
  readonly messageId: string;
  readonly channelId: string;
  readonly authorId: string;
  readonly snippet: string;
  readonly score: number;
  readonly createdAt: number;
  readonly threadRootId?: string;
}

/** Optional persistence for the index. */
export interface SearchStore {
  readAll(): Promise<readonly SearchDocument[]>;
  put(document: SearchDocument): Promise<void>;
  delete(messageId: string): Promise<void>;
  clear(): Promise<void>;
}

const TOKEN_PATTERN = /[\p{L}\p{N}_]+/gu;

/** Normalizes and tokenizes text into lowercase terms. */
export function tokenize(text: string): readonly string[] {
  const normalized = text.normalize("NFKC").toLowerCase();
  return normalized.match(TOKEN_PATTERN) ?? [];
}

function contextSnippet(text: string, terms: readonly string[], radius = 40): string {
  const lower = text.normalize("NFKC").toLowerCase();
  let position = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found >= 0 && (position === -1 || found < position)) {
      position = found;
    }
  }
  if (position === -1) {
    const trimmed = text.slice(0, radius * 2).trim();
    return text.length > radius * 2 ? `${trimmed}…` : trimmed;
  }
  const start = Math.max(0, position - radius);
  const end = Math.min(text.length, position + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

/** In-memory {@link SearchStore} for tests and non-browser hosts. */
export function memorySearchStore(seed: readonly SearchDocument[] = []): SearchStore {
  const documents = new Map<string, SearchDocument>();
  for (const document of seed) {
    documents.set(document.messageId, document);
  }
  return {
    readAll() {
      return Promise.resolve([...documents.values()]);
    },
    put(document) {
      documents.set(document.messageId, document);
      return Promise.resolve();
    },
    delete(messageId) {
      documents.delete(messageId);
      return Promise.resolve();
    },
    clear() {
      documents.clear();
      return Promise.resolve();
    },
  };
}

export interface SearchOptions {
  /** Maximum results. Defaults to 20. */
  readonly limit?: number;
  /** Minimum term length before prefix matching kicks in. Defaults to 2. */
  readonly minPrefixLength?: number;
}

/**
 * The live index. `load()` must be awaited once before querying so older
 * messages persisted by a previous session are searchable.
 */
export class SearchIndex {
  private readonly store: SearchStore;
  private readonly documents = new Map<string, SearchDocument>();
  private readonly postings = new Map<string, Set<string>>();
  private loaded = false;

  constructor(store: SearchStore = memorySearchStore()) {
    this.store = store;
  }

  /** Reads persisted documents into memory. Safe to call more than once. */
  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    const documents = await this.store.readAll();
    for (const document of documents) {
      this.insert(document);
    }
    this.loaded = true;
  }

  /** Indexes or replaces one decrypted message. */
  async index(document: SearchDocument): Promise<void> {
    const existing = this.documents.get(document.messageId);
    if (existing !== undefined) {
      // Re-reading unchanged history must not rewrite the backing store.
      if (
        existing.text === document.text &&
        existing.channelId === document.channelId &&
        existing.threadRootId === document.threadRootId
      ) {
        return;
      }
      this.removeFromPostings(document.messageId);
    }
    this.insert(document);
    await this.store.put(document);
  }

  /** Removes a message (edit replaces it; delete drops it). */
  async remove(messageId: string): Promise<void> {
    this.removeFromPostings(messageId);
    this.documents.delete(messageId);
    await this.store.delete(messageId);
  }

  /** Clears the in-memory index and the backing store. */
  async clear(): Promise<void> {
    this.documents.clear();
    this.postings.clear();
    await this.store.clear();
  }

  /** Number of indexed messages. */
  get size(): number {
    return this.documents.size;
  }

  has(messageId: string): boolean {
    return this.documents.has(messageId);
  }

  /** Queries the index; empty or whitespace-only text returns no hits. */
  query(text: string, options: SearchOptions = {}): readonly SearchHit[] {
    const terms = tokenize(text);
    const limit = options.limit ?? 20;
    if (terms.length === 0 || limit <= 0) {
      return [];
    }
    const minPrefixLength = options.minPrefixLength ?? 2;
    const scores = new Map<string, number>();
    for (const term of terms) {
      const matched = this.matchTerm(term, minPrefixLength);
      for (const [messageId, weight] of matched) {
        scores.set(messageId, (scores.get(messageId) ?? 0) + weight);
      }
    }
    const hits: SearchHit[] = [];
    for (const [messageId, score] of scores) {
      const document = this.documents.get(messageId);
      if (document === undefined) {
        continue;
      }
      hits.push({
        messageId,
        channelId: document.channelId,
        authorId: document.authorId,
        snippet: contextSnippet(document.text, terms),
        score,
        createdAt: document.createdAt,
        ...(document.threadRootId !== undefined ? { threadRootId: document.threadRootId } : {}),
      });
    }
    hits.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
    return hits.slice(0, limit);
  }

  private matchTerm(term: string, minPrefixLength: number): Map<string, number> {
    const weights = new Map<string, number>();
    const exact = this.postings.get(term);
    if (exact !== undefined) {
      for (const messageId of exact) {
        weights.set(messageId, 2);
      }
    }
    if (term.length >= minPrefixLength) {
      for (const [token, posting] of this.postings) {
        if (token === term || !token.startsWith(term)) {
          continue;
        }
        for (const messageId of posting) {
          weights.set(messageId, Math.max(weights.get(messageId) ?? 0, 1));
        }
      }
    }
    return weights;
  }

  private insert(document: SearchDocument): void {
    this.documents.set(document.messageId, document);
    for (const token of new Set(tokenize(document.text))) {
      const posting = this.postings.get(token) ?? new Set<string>();
      posting.add(document.messageId);
      this.postings.set(token, posting);
    }
  }

  private removeFromPostings(messageId: string): void {
    for (const [token, posting] of this.postings) {
      if (posting.delete(messageId) && posting.size === 0) {
        this.postings.delete(token);
      }
    }
  }
}

/** The search document for one server message. */
export function searchDocumentFor(message: MessagePayload): SearchDocument {
  return {
    messageId: message.id,
    channelId: message.channelId,
    authorId: message.authorId,
    text: message.body,
    createdAt: message.createdAt,
    ...(message.threadRootId !== null ? { threadRootId: message.threadRootId } : {}),
  };
}

/** Paged history reads the backfill walks. A `null` cursor is the newest page. */
export interface ArchiveSource {
  /** Root messages of a channel, newest page first. */
  listMessages(args: {
    channelId: string;
    cursor: string | null;
  }): Promise<Paginated<MessagePayload>>;
  /** Replies of one thread root. */
  listThreadMessages(args: {
    threadRootId: string;
    cursor: string | null;
  }): Promise<Paginated<MessagePayload>>;
}

interface ChannelProgress {
  cursor: string | null;
  pages: number;
  done: boolean;
}

/**
 * Pages server history into a {@link SearchIndex} so search reaches messages
 * the device never displayed. Each {@link ArchiveBackfill.step} reads one page
 * of roots, plus the replies of the threads on it, from the channel that is
 * furthest behind, so recent history of every channel is searchable first.
 * Progress lasts for the lifetime of the instance.
 */
export class ArchiveBackfill {
  private readonly index: SearchIndex;
  private readonly source: ArchiveSource;
  private readonly progress = new Map<string, ChannelProgress>();

  constructor(index: SearchIndex, source: ArchiveSource) {
    this.index = index;
    this.source = source;
  }

  /** Whether every given channel has been read back to its first message. */
  isComplete(channelIds: readonly string[]): boolean {
    return channelIds.every((channelId) => this.progress.get(channelId)?.done === true);
  }

  /**
   * Indexes one more page. Resolves `true` once every given channel is
   * complete. A connectivity failure rejects and leaves progress untouched so
   * the step can be retried; a channel the viewer may not read is skipped.
   */
  async step(channelIds: readonly string[]): Promise<boolean> {
    let channelId: string | undefined;
    let state: ChannelProgress | undefined;
    for (const candidate of channelIds) {
      const current = this.progress.get(candidate) ?? { cursor: null, pages: 0, done: false };
      this.progress.set(candidate, current);
      if (!current.done && (state === undefined || current.pages < state.pages)) {
        channelId = candidate;
        state = current;
      }
    }
    if (channelId === undefined || state === undefined) {
      return true;
    }
    let result: Paginated<MessagePayload>;
    try {
      result = await this.source.listMessages({ channelId, cursor: state.cursor });
    } catch (error) {
      if (isConnectivityError(error)) {
        throw error;
      }
      state.done = true;
      return this.isComplete(channelIds);
    }
    for (const message of result.page) {
      await this.ingest(message);
      if ((message.replyCount ?? 0) > 0) {
        await this.ingestThread(message.id);
      }
    }
    state.cursor = result.continueCursor;
    state.pages += 1;
    state.done = result.isDone;
    return this.isComplete(channelIds);
  }

  private async ingestThread(threadRootId: string): Promise<void> {
    let cursor: string | null = null;
    for (;;) {
      let result: Paginated<MessagePayload>;
      try {
        result = await this.source.listThreadMessages({ threadRootId, cursor });
      } catch (error) {
        if (isConnectivityError(error)) {
          throw error;
        }
        return;
      }
      for (const reply of result.page) {
        await this.ingest(reply);
      }
      if (result.isDone) {
        return;
      }
      cursor = result.continueCursor;
    }
  }

  private async ingest(message: MessagePayload): Promise<void> {
    if (message.deletedAt !== null) {
      if (this.index.has(message.id)) {
        await this.index.remove(message.id);
      }
      return;
    }
    if (message.body.length > 0) {
      await this.index.index(searchDocumentFor(message));
    }
  }
}
