import type { PresenceRow } from "@aulora/core";
import { describe, expect, it, vi } from "vitest";
import { createScopedPresence } from "../src/lib/convex-chat";
import { buildPresenceScope, PRESENCE_SCOPE_MAX } from "../src/lib/presence-scope";

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

describe("buildPresenceScope", () => {
  it("unions the timeline authors, displayed members, own user and DM partners", () => {
    const scope = buildPresenceScope({
      ownUserId: "me",
      timelineAuthorIds: ["a", "b", "a"],
      displayedMemberIds: ["b", "c"],
      channels: [
        { kind: "dm", memberIds: ["me", "d"] },
        { kind: "text", memberIds: ["me", "e"] },
      ],
    });
    expect(scope).toEqual(["me", "a", "b", "c", "d"]);
  });

  it("appends extra ids after the timeline and member set", () => {
    const scope = buildPresenceScope({
      ownUserId: "me",
      timelineAuthorIds: ["a"],
      displayedMemberIds: [],
      channels: [],
      extraUserIds: ["x", "a"],
    });
    expect(scope).toEqual(["me", "a", "x"]);
  });

  it("caps the scope at the server's id ceiling, keeping render order", () => {
    const many = Array.from({ length: PRESENCE_SCOPE_MAX + 25 }, (_, index) => `u${index}`);
    const scope = buildPresenceScope({
      ownUserId: "me",
      timelineAuthorIds: many,
      displayedMemberIds: [],
      channels: [],
    });
    expect(scope).toHaveLength(PRESENCE_SCOPE_MAX);
    expect(scope[0]).toBe("me");
    expect(scope.at(-1)).toBe(`u${PRESENCE_SCOPE_MAX - 2}`);
  });
});

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

  describe("against a server without presence.getMany", () => {
    /** Convex delivers the missing-function error with the result, not from `watchQuery`. */
    function oldServerClient(failsFirstRead: boolean) {
      const watched: { query: unknown; args: unknown; closed: boolean }[] = [];
      const listeners: (() => void)[] = [];
      let scopedFailing = failsFirstRead;
      const client = {
        watchQuery: (query: unknown, args: unknown) => {
          const entry = { query, args, closed: false };
          watched.push(entry);
          const isScoped = watched.length === 1;
          return {
            localQueryResult: () => {
              if (isScoped) {
                if (scopedFailing) {
                  throw new Error("Could not find public function for 'presence:getMany'");
                }
                return undefined;
              }
              return [row("a"), row("z")];
            },
            onUpdate: (listener: () => void) => {
              if (isScoped) {
                listeners.push(listener);
              }
              return () => {
                entry.closed = true;
              };
            },
          };
        },
      };
      return {
        client,
        watched,
        failNow: () => {
          scopedFailing = true;
          for (const listener of listeners) {
            listener();
          }
        },
      };
    }

    it("falls back to the scoped slice of presence.list when the result errors later", () => {
      const { client, watched, failNow } = oldServerClient(false);
      const presence = createScopedPresence(client as never);
      const seen: PresenceRow[][] = [];
      const off = presence.watch((rows) => {
        seen.push([...rows]);
      });
      presence.setScope(["a", "b"]);
      expect(watched).toHaveLength(1);

      expect(() => failNow()).not.toThrow();
      expect(watched).toHaveLength(2);
      expect(watched[0]?.closed).toBe(true);
      expect(watched[1]?.args).toEqual({});
      expect(seen.at(-1)?.map((entry) => entry.userId)).toEqual(["a"]);
      off();
      expect(watched[1]?.closed).toBe(true);
    });

    it("falls back at once when the first read already errors", () => {
      const { client, watched } = oldServerClient(true);
      const presence = createScopedPresence(client as never);
      const seen: PresenceRow[][] = [];
      const off = presence.watch((rows) => {
        seen.push([...rows]);
      });
      expect(() => presence.setScope(["a", "b"])).not.toThrow();
      expect(watched).toHaveLength(2);
      expect(seen.at(-1)?.map((entry) => entry.userId)).toEqual(["a"]);
      off();
    });
  });
});
