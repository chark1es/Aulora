import { debugLog, recordDebugFailure } from "@aulora/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccountScope } from "../src/lib/account-scope";

afterEach(() => {
  debugLog.clear();
});

describe("account scope", () => {
  it("records a failure while its account is current", () => {
    const record = vi.fn();
    const scope = createAccountScope(record);
    scope.record("outbox.load", new Error("boom"));
    expect(record).toHaveBeenCalledWith("outbox.load", expect.any(Error));
    expect(scope.active).toBe(true);
  });

  it("records nothing after the account closes", () => {
    const record = vi.fn();
    const scope = createAccountScope(record);
    scope.close();
    expect(scope.active).toBe(false);
    // A late rejection from the old account must not enter the next account's
    // debug report.
    scope.record("chat.start", new Error("old account failure"));
    expect(record).not.toHaveBeenCalled();
  });

  it("keeps a deferred old-account rejection out of the next account's report", async () => {
    let rejectStart!: (error: Error) => void;
    const oldScope = createAccountScope(recordDebugFailure);
    // Mirrors ChatProvider: the runtime start settles later and records only
    // while its own account scope is still active.
    const oldStart = new Promise<void>((_resolve, reject) => {
      rejectStart = reject;
    }).catch((error: Error) => {
      if (oldScope.active) oldScope.record("chat.start", error);
    });

    // Account A signs out: the scope closes and the shared log is cleared.
    oldScope.close();
    debugLog.clear();
    debugLog.record("account-b", "account B is current");

    rejectStart(new Error("A-only diagnostic sentinel"));
    await oldStart;

    const report = debugLog.report("account-b", "");
    expect(report).toContain("account B is current");
    expect(report).not.toContain("A-only diagnostic sentinel");
  });
});
