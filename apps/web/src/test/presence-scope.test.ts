import type { PresenceRow } from "@aulora/core";
import { describe, expect, it, vi } from "vitest";
import { createScopedPresence } from "../lib/convex-chat";

function row(userId: string): PresenceRow {
  return { userId, status: "online", customStatus: null, lastHeartbeat: 1 };
}

/** Minimal stand-in for the Convex client that records each watchQuery call. */
function fakeClient() {
  const calls: { query: unknown; args: { userIds: string[] } }[] = [];
  const emit = vi.fn();
  const client = {
    watchQuery: (query: unknown, args: { userIds: string[] }) => {
      calls.push({ query, args });
      const result = args.userIds.map(row);
      return {
        localQueryResult: () => result,
        onUpdate: (listener: () => void) => {
          emit(listener);
          return () => undefined;
        },
      };
    },
  };
  return { client, calls, emit };
}

describe("createScopedPresence", () => {
  it("serves presence.getMany for the scope instead of the whole-table presence.list", () => {
    const { client, calls } = fakeClient();
    const presence = createScopedPresence(client as never);
    const seen: PresenceRow[][] = [];
    const off = presence.watch((rows) => {
      seen.push([...rows]);
    });
    expect(calls).toHaveLength(0);

    presence.setScope(["b", "a", "b"]);
    expect(calls).toHaveLength(1);
    // The scoped query takes an explicit id list; the whole-table
    // `presence.list` would be watched with empty args instead.
    expect(calls[0]?.args).toEqual({ userIds: ["b", "a"] });
    expect(calls[0]?.query).toBeDefined();
    expect(seen.at(-1)?.map((entry) => entry.userId)).toEqual(["b", "a"]);

    off();
  });

  it("does not resubscribe when the scope is unchanged, and swaps it when it changes", () => {
    const { client, calls } = fakeClient();
    const presence = createScopedPresence(client as never);
    const off = presence.watch(() => undefined);

    presence.setScope(["a"]);
    presence.setScope(["a"]);
    expect(calls).toHaveLength(1);

    presence.setScope(["a", "b"]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args.userIds).toEqual(["a", "b"]);

    presence.setScope([]);
    // An empty scope needs no query at all; the previous one is torn down.
    expect(calls).toHaveLength(2);
    off();
  });

  it("shares one query across every listener", () => {
    const { client, calls } = fakeClient();
    const presence = createScopedPresence(client as never);
    const offA = presence.watch(() => undefined);
    const offB = presence.watch(() => undefined);
    presence.setScope(["a"]);
    expect(calls).toHaveLength(1);
    offA();
    offB();
  });
});
