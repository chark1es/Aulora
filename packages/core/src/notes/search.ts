/**
 * On-device inverted index over decrypted note titles and bodies, so search
 * feels instant and never sends note text anywhere. The server also offers a
 * permission-filtered search for cold starts; this index is the fast path
 * while notes are loaded.
 */

import { tokenize } from "../search/index.js";

export interface NoteSearchDoc {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly updatedAt: number;
}

export interface NoteSearchResult {
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
  readonly score: number;
  readonly updatedAt: number;
}

export interface NoteSearchOptions {
  /** Maximum results. Defaults to 30. */
  readonly limit?: number;
  /** Minimum term length before prefix matching kicks in. Defaults to 2. */
  readonly minPrefixLength?: number;
}

const SNIPPET_RADIUS = 60;

export class NoteSearchIndex {
  private readonly documents = new Map<string, NoteSearchDoc>();
  private readonly postings = new Map<string, Set<string>>();
  private readonly titleTokens = new Map<string, Set<string>>();

  /** Indexes or replaces one note. */
  upsert(document: NoteSearchDoc): void {
    this.remove(document.id);
    this.documents.set(document.id, document);
    const title = new Set(tokenize(document.title));
    this.titleTokens.set(document.id, title);
    const tokens = new Set([...title, ...tokenize(document.body)]);
    for (const token of tokens) {
      const posting = this.postings.get(token) ?? new Set<string>();
      posting.add(document.id);
      this.postings.set(token, posting);
    }
  }

  /** Removes a note (delete drops it; an edit replaces it). */
  remove(id: string): void {
    if (!this.documents.delete(id)) return;
    for (const [token, posting] of this.postings) {
      if (posting.delete(id) && posting.size === 0) this.postings.delete(token);
    }
    this.titleTokens.delete(id);
  }

  clear(): void {
    this.documents.clear();
    this.postings.clear();
    this.titleTokens.clear();
  }

  get size(): number {
    return this.documents.size;
  }

  has(id: string): boolean {
    return this.documents.has(id);
  }

  /** Queries the index; empty or whitespace-only text returns no hits. */
  query(text: string, options: NoteSearchOptions = {}): NoteSearchResult[] {
    const terms = tokenize(text);
    const limit = options.limit ?? 30;
    if (terms.length === 0 || limit <= 0) return [];
    const minPrefixLength = options.minPrefixLength ?? 2;
    const scores = new Map<string, number>();
    for (const term of terms) {
      const exact = this.postings.get(term);
      if (exact !== undefined) {
        for (const id of exact) scores.set(id, (scores.get(id) ?? 0) + 3);
      }
      if (term.length >= minPrefixLength) {
        for (const [token, posting] of this.postings) {
          if (token === term || !token.startsWith(term)) continue;
          for (const id of posting) scores.set(id, Math.max(scores.get(id) ?? 0, 1) + 1);
        }
      }
    }
    const results: NoteSearchResult[] = [];
    for (const [id, score] of scores) {
      const document = this.documents.get(id);
      if (document === undefined) continue;
      const titleMatch = [...(this.titleTokens.get(id) ?? [])].some((token) =>
        terms.some(
          (term) => token === term || (term.length >= minPrefixLength && token.startsWith(term)),
        ),
      );
      results.push({
        id,
        title: document.title,
        snippet: snippet(document, terms),
        score: titleMatch ? score + 5 : score,
        updatedAt: document.updatedAt,
      });
    }
    results.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);
    return results.slice(0, limit);
  }
}

function snippet(document: NoteSearchDoc, terms: readonly string[]): string {
  const source = document.body.trim().length > 0 ? document.body : document.title;
  const lower = source.normalize("NFKC").toLowerCase();
  let position = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found >= 0 && (position === -1 || found < position)) position = found;
  }
  if (position === -1) {
    const trimmed = source.slice(0, SNIPPET_RADIUS * 2).trim();
    return source.length > SNIPPET_RADIUS * 2 ? `${trimmed}…` : trimmed;
  }
  const start = Math.max(0, position - SNIPPET_RADIUS);
  const end = Math.min(source.length, position + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < source.length ? "…" : "";
  return `${prefix}${source.slice(start, end).trim()}${suffix}`;
}
