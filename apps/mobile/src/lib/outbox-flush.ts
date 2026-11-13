import type { Outbox, OutboxItem } from "@aulora/core";
import type { AccountScope } from "./account-scope";

/**
 * Flushes an outbox while attributing failures to the account that started the
 * flush.
 *
 * The outbox invokes `onFailure` and may settle after the provider moved to
 * another account. Capturing the scope here means a late rejection from the old
 * account is dropped instead of entering the new account's debug report. The
 * source string matches the previous provider-local recording.
 */
export async function flushOutboxInScope(
  outbox: Outbox,
  send: (item: OutboxItem) => Promise<void>,
  scope: AccountScope | undefined,
): Promise<void> {
  try {
    await outbox.flush(send, {
      onFailure: (failure) => {
        scope?.record(
          "outbox.send",
          new Error(`Queued send failed after ${failure.attempts} attempts: ${failure.reason}`),
        );
      },
    });
  } catch (error) {
    // A storage failure while listing or persisting must not escape the ticker,
    // and must not be attributed to whichever account is current by then.
    scope?.record("outbox.flush", error);
  }
}
