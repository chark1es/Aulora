import { debugLog, memoryOutboxStore, Outbox, recordDebugFailure } from "@aulora/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccountScope } from "../lib/account-scope";
import { flushOutboxInScope } from "../lib/outbox-flush";

afterEach(() => {
  debugLog.clear();
});

describe("scoped outbox diagnostics", () => {
  it("records a permanent send failure while its account is current", async () => {
    const queue = new Outbox({ store: memoryOutboxStore() });
    await queue.enqueue({ channelId: "c1", text: "queued" });
    const scope = createAccountScope(recordDebugFailure);

    await flushOutboxInScope(
      queue,
      async () => {
        throw new Error("permission denied");
      },
      scope,
    );

    const report = debugLog.report("account-a", "");
    expect(report).toContain("outbox.send");
    expect(report).toContain("don’t have permission to send messages");
  });

  it("drops a late old-account send failure after switching to B", async () => {
    const queue = new Outbox({ store: memoryOutboxStore() });
    await queue.enqueue({ channelId: "c1", text: "queued" });
    let rejectSend!: (error: Error) => void;
    const send = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSend = reject;
        }),
    );
    const scopeA = createAccountScope(recordDebugFailure);
    const flushA = flushOutboxInScope(queue, send, scopeA);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));

    // A signs out and B becomes current; A's scope closes before A's deferred
    // send settles. The real Outbox then calls the already-captured onFailure.
    scopeA.close();
    debugLog.clear();
    debugLog.record("account-b", "account B is current");
    rejectSend(new Error("permission denied for A-only sentinel"));
    await flushA;

    const report = debugLog.report("account-b", "");
    expect(report).toContain("account B is current");
    expect(report).not.toContain("A-only sentinel");
    expect(report).not.toContain("outbox.send");
  });

  it("drops a storage failure that settles after the account closed", async () => {
    const record = vi.fn();
    const brokenStore = {
      readAll: async () => {
        throw new Error("storage gone for A-only sentinel");
      },
      put: async () => undefined,
      delete: async () => undefined,
    };
    const queue = new Outbox({ store: brokenStore });
    const scope = createAccountScope(record);
    scope.close();

    await flushOutboxInScope(queue, async () => undefined, scope);

    expect(record).not.toHaveBeenCalled();
  });

  it("keeps recording storage failures for the current account", async () => {
    const record = vi.fn();
    const brokenStore = {
      readAll: async () => {
        throw new Error("storage gone");
      },
      put: async () => undefined,
      delete: async () => undefined,
    };
    const queue = new Outbox({ store: brokenStore });
    const scope = createAccountScope(record);

    await flushOutboxInScope(queue, async () => undefined, scope);

    expect(record).toHaveBeenCalledWith("outbox.flush", expect.any(Error));
  });
});
