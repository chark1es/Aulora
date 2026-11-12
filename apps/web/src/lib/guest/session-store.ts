/**
 * The guest's session token, kept for the life of one tab so a reload resumes
 * waiting or the call instead of starting over. It is the credential for the
 * call and nothing else: `sessionStorage` is per-tab and cleared on close, and
 * it is removed the moment the session ends in any way.
 */
const KEY = "aulora.guestSession.v1";

export interface StoredGuestSession {
  readonly sessionToken: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function readGuestSession(
  storage: StorageLike | null = defaultStorage(),
): StoredGuestSession | null {
  try {
    const raw = storage?.getItem(KEY);
    if (raw === null || raw === undefined) {
      return null;
    }
    const value = JSON.parse(raw) as Partial<StoredGuestSession>;
    return typeof value.sessionToken === "string" && value.sessionToken.length > 0
      ? { sessionToken: value.sessionToken }
      : null;
  } catch {
    return null;
  }
}

export function writeGuestSession(
  session: StoredGuestSession,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ sessionToken: session.sessionToken }));
  } catch {
    // Without storage a reload simply asks to join again.
  }
}

export function clearGuestSession(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
