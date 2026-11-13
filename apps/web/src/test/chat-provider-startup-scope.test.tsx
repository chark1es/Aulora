import { debugLog } from "@aulora/core";
import { act, render } from "@testing-library/react";
import type { ConvexReactClient } from "convex/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  function deferred(): {
    promise: Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  } {
    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
  return {
    outbox: new Map<string, ReturnType<typeof deferred>>(),
    search: new Map<string, ReturnType<typeof deferred>>(),
    runtime: undefined as unknown,
  };
});

// A store whose read never settles until the test decides, so cleanup really
// races an in-flight startup read.
vi.mock("../lib/outbox-store", () => ({
  webOutboxStore: (_url: string, userId: string) => {
    let entry = state.outbox.get(userId);
    if (entry === undefined) {
      let resolve!: (value: unknown) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<unknown>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      entry = { promise, resolve, reject };
      state.outbox.set(userId, entry);
    }
    const current = entry;
    return {
      readAll: () => current.promise,
      put: async () => undefined,
      delete: async () => undefined,
    };
  },
}));

vi.mock("../lib/search-store", () => ({
  webSearchStore: (_url: string, userId: string) => {
    let entry = state.search.get(userId);
    if (entry === undefined) {
      let resolve!: (value: unknown) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<unknown>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      entry = { promise, resolve, reject };
      state.search.set(userId, entry);
    }
    const current = entry;
    return {
      readAll: () => current.promise,
      put: async () => undefined,
      delete: async () => undefined,
      clear: async () => undefined,
    };
  },
}));

vi.mock("../lib/chat-runtime", () => ({
  createChatRuntime: async () => state.runtime,
}));

vi.mock("../lib/use-presence-heartbeat", () => ({
  usePresenceHeartbeat: () => undefined,
}));

import { ChatProvider } from "../providers/ChatProvider";

const client = { url: "https://one.example" } as unknown as ConvexReactClient;

function provider(userId: string) {
  return (
    <ChatProvider client={client} userId={userId} displayName={userId} channels={[]}>
      <div data-testid="child" />
    </ChatProvider>
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  state.outbox.clear();
  state.search.clear();
  state.runtime = {
    session: {
      dispose: vi.fn(),
      onDecrypted: () => () => undefined,
    },
    port: {},
    subscriptions: { watchPresence: () => () => undefined },
    client,
  };
  debugLog.clear();
});

afterEach(() => {
  debugLog.clear();
});

describe("ChatProvider startup storage scope", () => {
  it("drops a late account-A startup rejection after switching to B", async () => {
    const view = render(provider("A"));
    expect(state.outbox.has("A")).toBe(true);
    expect(state.search.has("A")).toBe(true);

    // Switch accounts; A's effect cleanup closes its scope before either
    // startup read settles.
    view.rerender(provider("B"));
    expect(state.outbox.has("B")).toBe(true);
    expect(state.search.has("B")).toBe(true);

    const sentinel = "A-only startup sentinel";
    await act(async () => {
      state.outbox.get("A")?.reject(new Error(`storage failure for ${sentinel}`));
      state.search.get("A")?.reject(new Error(`search failure for ${sentinel}`));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    // The captured A scope is closed, so the failure is consumed and dropped:
    // it is not recorded as B's and no unhandled rejection reaches the global
    // listener (Vitest also fails the file if one escapes).
    const report = debugLog.report("B", "");
    expect(report).not.toContain(sentinel);
    expect(report).not.toContain("outbox.startup");
    expect(report).not.toContain("search.load");
  });

  it("records current-account startup storage failures through its own scope", async () => {
    render(provider("A"));
    expect(state.outbox.has("A")).toBe(true);
    expect(state.search.has("A")).toBe(true);

    await act(async () => {
      state.outbox.get("A")?.reject(new Error("outbox storage current sentinel"));
      state.search.get("A")?.reject(new Error("search storage current sentinel"));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    const sources = debugLog.snapshot().map((entry) => entry.source);
    expect(sources).toContain("outbox.startup");
    expect(sources).toContain("search.load");
    const report = debugLog.report("A", "");
    expect(report).toContain("outbox storage current sentinel");
    expect(report).toContain("search storage current sentinel");
  });
});
