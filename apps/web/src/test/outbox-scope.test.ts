import { Outbox, type OutboxItem } from "@aulora/core";
import { afterEach, expect, it, vi } from "vitest";

const databases = vi.hoisted(() => new Map<string, Map<string, OutboxItem>>());
vi.mock("../lib/indexeddb", () => ({
  openKeyValueStore: (database: string) => {
    let items = databases.get(database);
    if (items === undefined) {
      items = new Map();
      databases.set(database, items);
    }
    const rows = items;
    return {
      getAll: async () => [...rows.values()],
      put: async (id: string, item: OutboxItem) => {
        rows.set(id, item);
      },
      delete: async (id: string) => {
        rows.delete(id);
      },
    };
  },
}));

import { webOutboxStore } from "../lib/outbox-store";

afterEach(() => vi.unstubAllGlobals());
it("isolates durable sends from other accounts, servers and the legacy database", async () => {
  vi.stubGlobal("indexedDB", {});
  databases.clear();
  const alice = new Outbox({ store: webOutboxStore("https://one.example", "alice") });
  const item = await alice.enqueue({ channelId: "c1", text: "offline", replyToId: "reply" });
  databases.set("aulora-outbox", new Map([[item.id, item]]));
  expect(await webOutboxStore("https://one.example", "bob").readAll()).toEqual([]);
  expect(await webOutboxStore("https://two.example", "alice").readAll()).toEqual([]);
  expect(await webOutboxStore("https://one.example/path/", "alice").readAll()).toEqual([item]);
});

it("normalizes storage scopes and tolerates relative or invalid URLs", async () => {
  const { storageScope } = await import("../lib/storage-scope");
  const { draftScope } = await import("../lib/drafts");
  for (const url of ["https://one.example/path", "/relative", "invalid"]) {
    expect(draftScope(url, "alice")).toBe(storageScope(url, "alice"));
    expect(storageScope(url, "alice")).not.toBe(storageScope(url, "bob"));
  }
  expect(storageScope("https://one.example/path", "alice")).toBe(
    storageScope("https://one.example/", "alice"),
  );
});

it("round trips broadcast markers and still reads older persisted sends", async () => {
  vi.stubGlobal("indexedDB", {});
  const store = webOutboxStore("https://markers.example", "alice");
  const queue = new Outbox({ store });
  const marked = await queue.enqueue({
    channelId: "c",
    text: "@here",
    mentionHere: true,
    mentionEveryone: false,
  });
  const legacy = await queue.enqueue({ channelId: "c", text: "legacy", mentionUserIds: ["bob"] });
  const reopened = new Outbox({ store: webOutboxStore("https://markers.example", "alice") });
  expect(await reopened.list()).toEqual([marked, legacy]);
  const sent: OutboxItem[] = [];
  await reopened.flush(async (item) => {
    sent.push(item);
  });
  expect(sent[0]).toMatchObject({ mentionHere: true, mentionEveryone: false });
  expect(sent[1]).not.toHaveProperty("mentionHere");
});
