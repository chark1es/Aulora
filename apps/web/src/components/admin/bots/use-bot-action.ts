/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { useState } from "react";

export interface BotAction {
  readonly busy: boolean;
  readonly error: string | null;
  /** Resolves true when the task succeeded, false when it failed. */
  readonly run: (task: () => Promise<unknown>, fallback?: string) => Promise<boolean>;
}

/**
 * Shared busy/error bookkeeping for a one-off bot mutation. Each small control
 * owns one so a failure only disables the thing that failed.
 */
export function useBotAction(): BotAction {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (
    task: () => Promise<unknown>,
    fallback = "That did not work.",
  ): Promise<boolean> => {
    setError(null);
    setBusy(true);
    try {
      await task();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, run };
}
