import { type EncryptionContext, isSealed, openString, SseError } from "./sse";

/**
 * Bounded cache of opened content, keyed by `scope + record + envelope`.
 *
 * A live query re-runs whenever any message in its channel changes, and each
 * run used to AES-GCM-decrypt the whole returned page again even though the
 * unchanged rows carry the identical ciphertext. Message edits and deletions
 * write a new envelope (or clear the row), so a ciphertext hit is always the
 * same plaintext for the same context.
 *
 * The cache lives in the server process that just decrypted the value and is
 * bounded in both entries and characters, so it never becomes a second store of
 * message history. Nothing here is logged or persisted. Values that fail to
 * open are never cached.
 */
const MAX_OPENED_ENTRIES = 1000;
const MAX_OPENED_CHARS = 512 * 1024;

const opened = new Map<string, string>();
let openedChars = 0;

function cacheKey(context: EncryptionContext, sealed: string): string {
  return `${context.scope}\u0000${context.recordId}\u0000${sealed}`;
}

function remember(key: string, plaintext: string): void {
  if (plaintext.length > MAX_OPENED_CHARS) {
    return;
  }
  const existing = opened.get(key);
  if (existing !== undefined) {
    openedChars -= existing.length;
    opened.delete(key);
  }
  opened.set(key, plaintext);
  openedChars += plaintext.length;
  // Insertion-order eviction keeps the cache a least-recently-inserted window;
  // re-inserting on hit below makes it least-recently-used in practice.
  while (opened.size > MAX_OPENED_ENTRIES || openedChars > MAX_OPENED_CHARS) {
    const oldest = opened.keys().next();
    if (oldest.done === true) {
      break;
    }
    openedChars -= opened.get(oldest.value)?.length ?? 0;
    opened.delete(oldest.value);
  }
}

/** Test hook: drops cached plaintext so a suite can measure decrypt calls. */
export function clearOpenedContentCache(): void {
  opened.clear();
  openedChars = 0;
}

/**
 * Reads a server-sealed column for a client. Values without an `aulora-sse-*`
 * envelope (legacy or plaintext dev data) pass through unchanged; a sealed value
 * that fails to open is a real error and is surfaced.
 */
export async function openContent(context: EncryptionContext, sealed: string): Promise<string> {
  if (!isSealed(sealed)) {
    return sealed;
  }
  const key = cacheKey(context, sealed);
  const hit = opened.get(key);
  if (hit !== undefined) {
    // Re-insert so a hot page stays ahead of colder history.
    opened.delete(key);
    opened.set(key, hit);
    return hit;
  }
  try {
    const plaintext = await openString(context, sealed);
    remember(key, plaintext);
    return plaintext;
  } catch (error) {
    if (error instanceof SseError && error.code === "not-sealed") {
      return sealed;
    }
    throw error;
  }
}

/** Like {@link openContent} but preserves a null that means "column absent". */
export async function openContentOptional(
  context: EncryptionContext,
  sealed: string | undefined,
): Promise<string | null> {
  if (sealed === undefined) {
    return null;
  }
  return await openContent(context, sealed);
}
