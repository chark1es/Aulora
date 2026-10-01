import { describe, expect, it } from "vitest";
import {
  ArchiveBackfill,
  type ArchiveSource,
  type MessagePayload,
  memorySearchStore,
  type SearchDocument,
  SearchIndex,
  tokenize,
} from "../src/index.js";

function doc(overrides: Partial<SearchDocument> & { messageId: string }): SearchDocument {
  return {
    channelId: "c1",
    authorId: "u1",
    text: "",
    createdAt: 0,
    ...overrides,
  };
}

describe("tokenize", () => {
  it("lowercases, normalizes accents and splits on punctuation", () => {
    expect(tokenize("Héllo, WORLD! foo_bar")).toEqual(["héllo", "world", "foo_bar"]);
  });
});

describe("SearchIndex", () => {
  it("finds exact terms and returns a snippet around the match", async () => {
    const index = new SearchIndex();
    await index.load();
    await index.index(
      doc({
        messageId: "m1",
        text: "Deploying the release candidate to production tonight",
        createdAt: 10,
      }),
    );
    await index.index(doc({ messageId: "m2", text: "unrelated", createdAt: 20 }));

    const hits = index.query("release");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.messageId).toBe("m1");
    expect(hits[0]?.snippet.toLowerCase()).toContain("release");
  });

  it("reports the author of each hit so results can show who said it", async () => {
    const index = new SearchIndex();
    await index.load();
    await index.index(doc({ messageId: "m1", authorId: "u7", text: "ship it" }));
    expect(index.query("ship")[0]?.authorId).toBe("u7");
  });

  it("supports prefix matching for as-you-type search", async () => {
    const index = new SearchIndex();
    await index.load();
    await index.index(doc({ messageId: "m1", text: "deployment pipeline" }));

    expect(index.query("dep").map((hit) => hit.messageId)).toContain("m1");
    expect(index.query("z")).toHaveLength(0);
  });

  it("ranks messages matching more terms first", async () => {
    const index = new SearchIndex();
    await index.load();
    await index.index(doc({ messageId: "both", text: "alpha beta", createdAt: 1 }));
    await index.index(doc({ messageId: "one", text: "alpha only", createdAt: 2 }));

    const hits = index.query("alpha beta");
    expect(hits[0]?.messageId).toBe("both");
    expect(hits.some((hit) => hit.messageId === "one")).toBe(true);
  });

  it("replaces an edited message and removes deleted ones", async () => {
    const index = new SearchIndex();
    await index.load();
    await index.index(doc({ messageId: "m1", text: "old words" }));
    await index.index(doc({ messageId: "m1", text: "new words" }));

    expect(index.query("old")).toHaveLength(0);
    expect(index.query("new")).toHaveLength(1);

    await index.remove("m1");
    expect(index.size).toBe(0);
    expect(index.query("new")).toHaveLength(0);
  });

  it("backfills from the persisted store on load", async () => {
    const store = memorySearchStore();
    const first = new SearchIndex(store);
    await first.load();
    await first.index(doc({ messageId: "m1", text: "persisted across sessions" }));

    const reopened = new SearchIndex(store);
    expect(reopened.query("persisted")).toHaveLength(0);
    await reopened.load();
    expect(reopened.query("persisted")).toHaveLength(1);
  });

  it("returns nothing for empty queries and respects the limit", async () => {
    const index = new SearchIndex();
    await index.load();
    for (let number = 0; number < 5; number += 1) {
      await index.index(doc({ messageId: `m${number}`, text: "shared term", createdAt: number }));
    }
    expect(index.query("   ")).toHaveLength(0);
    expect(index.query("shared", { limit: 2 })).toHaveLength(2);
  });
});

function payload(overrides: Partial<MessagePayload> & { id: string }): MessagePayload {
  return {
    channelId: "c1",
    authorId: "u1",
    body: "",
    threadRootId: null,
    attachmentIds: [],
    mentionUserIds: [],
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    createdAt: 0,
    ...overrides,
  };
}

/** Serves fixed pages, newest first, two messages per page. */
function archive(
  channels: Record<string, readonly MessagePayload[]>,
  threads: Record<string, readonly MessagePayload[]> = {},
): ArchiveSource & { readonly reads: string[] } {
  const reads: string[] = [];
  const page = (all: readonly MessagePayload[], cursor: string | null) => {
    const start = cursor === null ? 0 : Number(cursor);
    const end = start + 2;
    return { page: all.slice(start, end), isDone: end >= all.length, continueCursor: String(end) };
  };
  return {
    reads,
    async listMessages({ channelId, cursor }) {
      reads.push(channelId);
      const messages = channels[channelId];
      if (messages === undefined) {
        throw new Error("Missing permission");
      }
      return page(messages, cursor);
    },
    async listThreadMessages({ threadRootId, cursor }) {
      return page(threads[threadRootId] ?? [], cursor);
    },
  };
}

describe("ArchiveBackfill", () => {
  it("pages every channel into the index, least-read channel first", async () => {
    const index = new SearchIndex();
    const source = archive({
      c1: [
        payload({ id: "a3", body: "newest alpha" }),
        payload({ id: "a2", body: "middle alpha" }),
        payload({ id: "a1", body: "oldest alpha" }),
      ],
      c2: [payload({ id: "b1", channelId: "c2", body: "beta" })],
    });
    const backfill = new ArchiveBackfill(index, source);

    expect(await backfill.step(["c1", "c2"])).toBe(false);
    expect(index.query("oldest")).toHaveLength(0);
    expect(await backfill.step(["c1", "c2"])).toBe(false);
    expect(await backfill.step(["c1", "c2"])).toBe(true);

    expect(source.reads).toEqual(["c1", "c2", "c1"]);
    expect(index.query("oldest").map((hit) => hit.messageId)).toEqual(["a1"]);
    expect(index.query("beta")[0]?.channelId).toBe("c2");
    expect(backfill.isComplete(["c1", "c2"])).toBe(true);
    expect(await backfill.step(["c1", "c2"])).toBe(true);
    expect(source.reads).toHaveLength(3);
  });

  it("indexes thread replies with their root and drops deleted messages", async () => {
    const index = new SearchIndex();
    await index.index({
      messageId: "gone",
      channelId: "c1",
      authorId: "u1",
      text: "retracted",
      createdAt: 1,
    });
    const source = archive(
      {
        c1: [
          payload({ id: "root", body: "kickoff", replyCount: 3 }),
          payload({ id: "gone", body: "retracted", deletedAt: 5 }),
        ],
      },
      {
        root: [
          payload({ id: "r1", body: "first reply", threadRootId: "root" }),
          payload({ id: "r2", body: "second reply", threadRootId: "root" }),
          payload({ id: "r3", body: "third reply", threadRootId: "root" }),
        ],
      },
    );

    expect(await new ArchiveBackfill(index, source).step(["c1"])).toBe(true);
    expect(index.query("retracted")).toHaveLength(0);
    expect(index.query("third")[0]).toMatchObject({ messageId: "r3", threadRootId: "root" });
    expect(index.query("kickoff")[0]?.threadRootId).toBeUndefined();
  });

  it("skips unreadable channels and retries after a connectivity failure", async () => {
    const index = new SearchIndex();
    const source = archive({ c1: [payload({ id: "a1", body: "reachable" })] });
    const backfill = new ArchiveBackfill(index, source);
    expect(await backfill.step(["private", "c1"])).toBe(false);
    expect(await backfill.step(["private", "c1"])).toBe(true);
    expect(index.query("reachable")).toHaveLength(1);

    let offline = true;
    const flaky = new ArchiveBackfill(index, {
      ...source,
      async listMessages(args) {
        if (offline) {
          throw new Error("Failed to fetch");
        }
        return source.listMessages(args);
      },
    });
    await expect(flaky.step(["c1"])).rejects.toThrow("Failed to fetch");
    expect(flaky.isComplete(["c1"])).toBe(false);
    offline = false;
    expect(await flaky.step(["c1"])).toBe(true);
  });

  it("does not rewrite the store for history it already holds", async () => {
    const store = memorySearchStore();
    let writes = 0;
    const index = new SearchIndex({
      ...store,
      async put(document) {
        writes += 1;
        await store.put(document);
      },
    });
    const source = archive({ c1: [payload({ id: "a1", body: "stable" })] });
    await new ArchiveBackfill(index, source).step(["c1"]);
    await new ArchiveBackfill(index, source).step(["c1"]);
    expect(writes).toBe(1);
  });
});
