/**
 * Local, on-device inverted search index over **decrypted** message text.
 *
 * The index never sends text anywhere: callers feed it plaintext that was
 * server-decrypted, and only ids and snippets come back. It is
 * persistent through a {@link SearchStore} adapter (IndexedDB on web, an
 * in-memory store in tests) and backfills from decrypted history in the
 * background via {@link SearchIndex.load}.
 */

/** One indexed, already-decrypted message. */
export interface SearchDocument {
  readonly messageId: string;
  readonly channelId: string;
  readonly authorId: string;
  readonly text: string;
  readonly createdAt: number;
}

/** A ranked result with a context snippet. */
export interface SearchHit {
  readonly messageId: string;
  readonly channelId: string;
  readonly authorId: string;
  readonly snippet: string;
  readonly score: number;
  readonly createdAt: number;
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
    async readAll() {
      return [...documents.values()];
    },
    async put(document) {
      documents.set(document.messageId, document);
    },
    async delete(messageId) {
      documents.delete(messageId);
    },
    async clear() {
      documents.clear();
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
    if (this.documents.has(document.messageId)) {
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
