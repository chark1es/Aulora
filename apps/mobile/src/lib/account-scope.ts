import { captureDebugAccountOwnership } from "@aulora/core";

/**
 * Lifetime guard for work that can outlive an account transition.
 *
 * A runtime start, outbox load or callback read may settle after the person
 * signed out or switched workspace. Recording diagnostics before checking the
 * guard would copy the old account's error text into the new account's debug
 * report, which the repository's no-cross-account-data rule forbids.
 */
export interface AccountScope {
  readonly active: boolean;
  /** Records a failure only while this account's work is still current. */
  record: (_source: string, _error: unknown) => void;
  close: () => void;
}

export function createAccountScope(
  recordFailure: (_source: string, _error: unknown) => void,
): AccountScope {
  let active = true;
  const ownsAccount = captureDebugAccountOwnership();
  return {
    get active() {
      return active && ownsAccount();
    },
    record(source, error) {
      if (active && ownsAccount()) {
        recordFailure(source, error);
      }
    },
    close() {
      active = false;
    },
  };
}
