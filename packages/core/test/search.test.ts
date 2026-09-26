import { describe, expect, it } from "vitest";
import { memorySearchStore, type SearchDocument, SearchIndex, tokenize } from "../src/index.js";

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
