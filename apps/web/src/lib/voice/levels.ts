/**
 * High-frequency call values kept out of the React context.
 *
 * The voice context's value is rebuilt whenever the snapshot changes, so every
 * `useVoice()` consumer re-renders. Audio levels change ~10 times a second and
 * link quality every few seconds, which is far too often for the chat tree to
 * re-render. They live here instead and are read through narrow
 * `useSyncExternalStore` selectors (see `providers/voice-levels.tsx`), so only
 * the meter or tile that shows a value re-renders when it moves.
 */

/** A coarse link-quality bucket, mirroring `networkQuality` in `@aulora/core`. */
export type LinkQuality = "good" | "fair" | "poor";

/** Rounds to whole percent: sub-percent jitter must not wake React. */
function quantize(level: number): number {
  const clamped = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  return Math.round(clamped * 100) / 100;
}

export class VoiceLevelsStore {
  private mic = 0;
  private readonly micListeners = new Set<() => void>();
  private readonly levels = new Map<string, number>();
  private readonly levelListeners = new Map<string, Set<() => void>>();
  private readonly qualities = new Map<string, LinkQuality>();
  private readonly qualityListeners = new Map<string, Set<() => void>>();

  // ---- Local microphone ----------------------------------------------------

  setMicLevel(level: number): void {
    const next = quantize(level);
    if (next === this.mic) {
      return;
    }
    this.mic = next;
    for (const listener of this.micListeners) {
      listener();
    }
  }

  getMicLevel = (): number => this.mic;

  subscribeMic = (listener: () => void): (() => void) => {
    this.micListeners.add(listener);
    return () => {
      this.micListeners.delete(listener);
    };
  };

  // ---- Remote participants -------------------------------------------------

  setRemoteLevel(userId: string, level: number): void {
    const next = quantize(level);
    if ((this.levels.get(userId) ?? 0) === next) {
      return;
    }
    this.levels.set(userId, next);
    this.notifyLevel(userId);
  }

  getRemoteLevel = (userId: string): number => this.levels.get(userId) ?? 0;

  subscribeRemoteLevel = (userId: string, listener: () => void): (() => void) => {
    const listeners = this.levelListeners.get(userId) ?? new Set<() => void>();
    listeners.add(listener);
    this.levelListeners.set(userId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.levelListeners.delete(userId);
      }
    };
  };

  private notifyLevel(userId: string): void {
    for (const listener of this.levelListeners.get(userId) ?? []) {
      listener();
    }
  }

  // ---- Link quality --------------------------------------------------------

  setQuality(userId: string, quality: LinkQuality | null): void {
    const current = this.qualities.get(userId) ?? null;
    if (current === quality) {
      return;
    }
    if (quality === null) {
      this.qualities.delete(userId);
    } else {
      this.qualities.set(userId, quality);
    }
    for (const listener of this.qualityListeners.get(userId) ?? []) {
      listener();
    }
  }

  getQuality = (userId: string): LinkQuality | null => this.qualities.get(userId) ?? null;

  subscribeQuality = (userId: string, listener: () => void): (() => void) => {
    const listeners = this.qualityListeners.get(userId) ?? new Set<() => void>();
    listeners.add(listener);
    this.qualityListeners.set(userId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.qualityListeners.delete(userId);
      }
    };
  };

  // ---- Lifetime ------------------------------------------------------------

  /** Drops every per-participant value at the end of a call. */
  reset(): void {
    const users = new Set([...this.levels.keys(), ...this.qualities.keys()]);
    this.levels.clear();
    this.qualities.clear();
    for (const userId of users) {
      this.notifyLevel(userId);
      for (const listener of this.qualityListeners.get(userId) ?? []) {
        listener();
      }
    }
    this.setMicLevel(0);
  }
}
