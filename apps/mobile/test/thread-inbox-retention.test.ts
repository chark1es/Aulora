import { describe, expect, it } from "vitest";
import { threadInboxQueryArgs } from "../src/lib/thread-inbox-query";
import { expireHiddenTabs, mountedTabs, visitTab } from "../src/lib/visited-tabs";

const TABS = ["chats", "dms", "boards", "notes", "threads", "you"] as const;
type Tab = (typeof TABS)[number];

/**
 * Models what the hub and the parent Threads query share: the MRU set decides
 * the mounted tabs, and the query args follow that mounted set. `pagesLoaded`
 * is the parent paginated query's retained state; skipping the query resets it.
 */
function hub(initial: Tab = "chats") {
  let retained: ReadonlySet<Tab> = new Set<Tab>([initial]);
  let active: Tab = initial;
  let pagesLoaded = 0;
  const go = (tab: Tab) => {
    active = tab;
    retained = visitTab(retained, tab);
    const mounted = mountedTabs(TABS, active, retained);
    const args = threadInboxQueryArgs(true, mounted.includes("threads"), true);
    if (args.page === "skip") pagesLoaded = 0;
    return { mounted, args };
  };
  const idle = () => {
    retained = expireHiddenTabs(retained, active);
    const mounted = mountedTabs(TABS, active, retained);
    const args = threadInboxQueryArgs(true, mounted.includes("threads"), true);
    if (args.page === "skip") pagesLoaded = 0;
    return { mounted, args };
  };
  return {
    go,
    idle,
    loadThreadPages: (pages: number) => {
      pagesLoaded = pages;
    },
    get pagesLoaded() {
      return pagesLoaded;
    },
  };
}

describe("Threads inbox retention", () => {
  it("keeps the paginated query subscribed while Threads stays retained", () => {
    const screen = hub();
    expect(screen.go("threads").args.page).toEqual({});
    screen.loadThreadPages(3);

    // Chats and Notes still leave Threads inside the three-tab MRU window.
    expect(screen.go("notes").mounted).toContain("threads");
    expect(screen.go("you").mounted).toContain("threads");
    expect(screen.pagesLoaded).toBe(3);
  });

  it("skips and resets loaded pages once another tab evicts Threads", () => {
    const screen = hub();
    screen.go("threads");
    screen.loadThreadPages(3);
    screen.go("notes");
    screen.go("you");

    // Opening a fourth tab evicts the least recently used one, Threads.
    const evicted = screen.go("chats");
    expect(evicted.mounted).not.toContain("threads");
    expect(evicted.args).toEqual({ legacy: "skip", page: "skip" });
    expect(screen.pagesLoaded).toBe(0);
  });

  it("releases Threads when the hidden lifetime expires without eviction", () => {
    const screen = hub();
    screen.go("threads");
    screen.loadThreadPages(2);
    screen.go("notes");
    screen.go("you");
    expect(screen.pagesLoaded).toBe(2);

    const expired = screen.idle();
    expect(expired.mounted).toEqual(["you"]);
    expect(expired.args.page).toBe("skip");
    expect(screen.pagesLoaded).toBe(0);
  });

  it("serves the legacy inbox only when the server lacks paging", () => {
    expect(threadInboxQueryArgs(false, true, false)).toEqual({ legacy: "skip", page: "skip" });
    expect(threadInboxQueryArgs(true, false, false)).toEqual({ legacy: "skip", page: "skip" });
    expect(threadInboxQueryArgs(true, true, false)).toEqual({
      legacy: { limit: 50 },
      page: "skip",
    });
  });
});
