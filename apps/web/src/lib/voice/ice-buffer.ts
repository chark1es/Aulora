/**
 * Pools ICE candidates for a short window so one peer's trickle becomes one
 * signalling mutation instead of one per candidate.
 *
 * A connection gathers a handful of candidates within tens of milliseconds.
 * Sending each as its own Convex mutation is a write per candidate per peer;
 * a 6-person mesh could issue dozens of writes just to open its connections.
 * The window is small enough that connectivity checks are not delayed in any
 * way a person can notice.
 */

/** How long candidates are pooled before they are sent as one signal. */
export const ICE_COALESCE_MS = 75;

/** Most candidates one signal carries; a pathological gather starts a new batch. */
export const ICE_BATCH_LIMIT = 16;

/** Called with the peer a batch belongs to and every payload in it. */
export type IceSend = (toUserId: string, payloads: readonly string[]) => void;

export class IceSignalBuffer {
  private readonly batches = new Map<string, string[]>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly send: IceSend) {}

  /** Adds one serialized candidate, flushing immediately at the batch limit. */
  add(toUserId: string, payload: string): void {
    const batch = this.batches.get(toUserId) ?? [];
    batch.push(payload);
    this.batches.set(toUserId, batch);
    if (batch.length >= ICE_BATCH_LIMIT) {
      this.flush(toUserId);
      return;
    }
    if (this.timers.has(toUserId)) {
      return;
    }
    this.timers.set(
      toUserId,
      setTimeout(() => {
        this.timers.delete(toUserId);
        this.flush(toUserId);
      }, ICE_COALESCE_MS),
    );
  }

  /** Sends and clears whatever is pooled for a peer. Safe when nothing is. */
  flush(toUserId: string): void {
    const timer = this.timers.get(toUserId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(toUserId);
    }
    const batch = this.batches.get(toUserId);
    this.batches.delete(toUserId);
    if (batch !== undefined && batch.length > 0) {
      this.send(toUserId, batch);
    }
  }

  /** Forgets a peer's pooled candidates, e.g. when its connection closes. */
  drop(toUserId: string): void {
    const timer = this.timers.get(toUserId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(toUserId);
    }
    this.batches.delete(toUserId);
  }

  /** Drops every batch at the end of a call. */
  clear(): void {
    for (const toUserId of [...this.batches.keys(), ...this.timers.keys()]) {
      this.drop(toUserId);
    }
  }
}
