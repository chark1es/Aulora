import type { MessagePayload, Paginated } from "@aulora/core";
import { describe, expect, it, vi } from "vitest";
import { MAX_THREAD_PAGES, watchAllThreadPages } from "../src/lib/thread-pages";

function reply(id: string): MessagePayload {
  return {
    id,
    channelId: "channel",
    authorId: "alice",
    body: id,
    threadRootId: "root",
    replyToId: null,
    attachmentIds: [],
    mentionUserIds: [],
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    createdAt: 1,
  };
}

function page(ids: readonly string[], isDone: boolean, next: string): Paginated<MessagePayload> {
  return { page: ids.map(reply), isDone, continueCursor: next };
}

/** A fake live client whose pages can be updated between assertions. */
function fakePages(initial: readonly Paginated<MessagePayload>[]) {
  const watchers: {
    index: number;
    result: Paginated<MessagePayload> | undefined;
    listeners: Set<() => void>;
    closed: boolean;
    fails: boolean;
  }[] = [];
  const watchPage = (cursor: string | null) => {
    const index = cursor === null ? 0 : Number(cursor);
    const entry = {
      index,
      result: initial[index] as Paginated<MessagePayload> | undefined,
      listeners: new Set<() => void>(),
      closed: false,
      fails: false,
    };
    watchers.push(entry);
    return {
      localQueryResult: () => {
        if (entry.fails) throw new Error("access revoked");
        return entry.result;
      },
      onUpdate: (listener: () => void) => {
        entry.listeners.add(listener);
        return () => {
          entry.listeners.delete(listener);
          entry.closed = true;
        };
      },
    };
  };
  const update = (index: number, result: Paginated<MessagePayload>) => {
    const entry = watchers.find((candidate) => candidate.index === index);
    if (entry === undefined) return;
    entry.result = result;
    entry.fails = false;
    for (const listener of entry.listeners) listener();
  };
  const fail = (index: number) => {
    const entry = watchers.find((candidate) => candidate.index === index);
    if (entry === undefined) return;
    entry.fails = true;
  };
  const notify = (index: number) => {
    const entry = watchers.find((candidate) => candidate.index === index);
    if (entry === undefined) return;
    for (const listener of entry.listeners) listener();
  };
  return { watchPage, watchers, update, fail, notify };
}

describe("watchAllThreadPages", () => {
  it("loads every page so replies past the first hundred appear oldest first", () => {
    const { watchPage, watchers } = fakePages([
      page(["a", "b"], false, "1"),
      page(["c"], false, "2"),
      page(["d"], true, ""),
    ]);
    const seen: string[][] = [];
    const off = watchAllThreadPages(watchPage, (messages) => {
      seen.push(messages.map((message) => message.id));
    });

    expect(seen.at(-1)).toEqual(["a", "b", "c", "d"]);
    expect(watchers.map((entry) => entry.index)).toEqual([0, 1, 2]);
    // The final page is done, so no further subscription is opened.
    expect(watchers).toHaveLength(3);

    off();
    expect(watchers.every((entry) => entry.closed)).toBe(true);
  });

  it("keeps the newest page live so a new reply reaches the list", () => {
    const { watchPage, update } = fakePages([page(["a", "b"], false, "1"), page(["c"], true, "")]);
    const seen: string[][] = [];
    const off = watchAllThreadPages(watchPage, (messages) => {
      seen.push(messages.map((message) => message.id));
    });
    expect(seen.at(-1)).toEqual(["a", "b", "c"]);

    update(1, page(["c", "d"], true, ""));
    expect(seen.at(-1)).toEqual(["a", "b", "c", "d"]);
    off();
  });

  it("caps how many pages a huge thread can keep live", () => {
    const endless = Array.from({ length: MAX_THREAD_PAGES + 5 }, (_, index) =>
      page([`r${index}`], false, String(index + 1)),
    );
    const { watchPage, watchers } = fakePages(endless);
    const off = watchAllThreadPages(watchPage, () => undefined);

    expect(watchers).toHaveLength(MAX_THREAD_PAGES);
    expect(watchers.at(-1)?.index).toBe(MAX_THREAD_PAGES - 1);
    off();
    expect(watchers.every((entry) => entry.closed)).toBe(true);
  });

  it("ignores a failing page without throwing out of the update callback", () => {
    const { watchPage, watchers, fail, update, notify } = fakePages([
      page(["a"], false, "1"),
      page(["b"], false, "2"),
      page(["c"], true, ""),
    ]);
    const seen: string[][] = [];
    const onError = vi.fn();
    const off = watchAllThreadPages(
      watchPage,
      (messages) => {
        seen.push(messages.map((message) => message.id));
      },
      { cursor: null, onPage: vi.fn(), onError },
    );
    expect(seen.at(-1)).toEqual(["a", "b", "c"]);

    fail(1);
    expect(() => notify(1)).not.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "access revoked" }));
    // The failed snapshot is ignored, so the rest of the thread remains.
    expect(seen.at(-1)).toEqual(["a", "b", "c"]);
    update(1, page(["b", "d"], false, "2"));
    expect(seen.at(-1)).toEqual(["a", "b", "d", "c"]);
    expect(watchers).toHaveLength(3);
    off();
  });
});

it("exposes a continuation at the cap and advances to a live tail window", () => {
  const initial = Array.from({ length: MAX_THREAD_PAGES + 2 }, (_, index) =>
    page(
      Array.from(
        { length: index === MAX_THREAD_PAGES + 1 ? 3 : 100 },
        (_, item) => `r${index}-${item}`,
      ),
      index === MAX_THREAD_PAGES + 1,
      String(index + 1),
    ),
  );
  const { watchPage, watchers, update } = fakePages(initial);
  const cursors: (string | null)[] = [];
  const seen: string[][] = [];
  const off = watchAllThreadPages(watchPage, (messages) => seen.push(messages.map((m) => m.id)), {
    cursor: null,
    onPage: (cursor) => cursors.push(cursor),
  });
  expect(cursors.at(-1)).toBe(String(MAX_THREAD_PAGES));
  expect(seen.at(-1)).toHaveLength(300);
  off();
  const tail = watchAllThreadPages(watchPage, (messages) => seen.push(messages.map((m) => m.id)), {
    cursor: cursors.at(-1) ?? null,
    onPage: (cursor) => cursors.push(cursor),
  });
  expect(watchers.filter((watcher) => !watcher.closed)).toHaveLength(2);
  expect(cursors.at(-1)).toBeNull();
  expect(seen.at(-1)).toHaveLength(103);
  expect(seen.at(-1)?.at(-1)).toBe(`r${MAX_THREAD_PAGES + 1}-2`);
  update(MAX_THREAD_PAGES + 1, page(["tail0", "tail1", "tail2", "newest"], true, ""));
  expect(seen.at(-1)).toHaveLength(104);
  expect(seen.at(-1)?.at(-1)).toBe("newest");
  tail();
});
