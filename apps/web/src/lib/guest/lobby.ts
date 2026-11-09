/** "1 person is waiting" / "3 people are waiting", the lobby prompt's heading. */
export function waitingLabel(count: number): string {
  return count === 1 ? "1 person is waiting" : `${count} people are waiting`;
}

interface Expiring {
  readonly expiresAt: number;
}

/**
 * The lobby entries that can still be answered. The server expires a request
 * (or a session past its cap) by time alone, so the live query does not re-run
 * when one lapses: the prompt filters by the clock itself and never offers
 * Admit for a request the server would refuse.
 */
export function stillWaiting<T extends Expiring>(entries: readonly T[], now: number): T[] {
  return entries.filter((entry) => entry.expiresAt > now);
}

/** Milliseconds until the first of these entries lapses, or `null` when none will. */
export function msUntilNextExpiry(entries: readonly Expiring[], now: number): number | null {
  let soonest: number | null = null;
  for (const entry of entries) {
    const remaining = entry.expiresAt - now;
    if (remaining > 0 && (soonest === null || remaining < soonest)) {
      soonest = remaining;
    }
  }
  return soonest;
}
