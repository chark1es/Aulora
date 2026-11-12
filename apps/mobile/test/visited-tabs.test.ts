import { describe, expect, it } from "vitest";
import {
  expireHiddenTabs,
  HIDDEN_TAB_TTL_MS,
  MAX_RETAINED_TABS,
  mountedTabs,
  threadsInboxVisible,
  visitTab,
} from "../src/lib/visited-tabs";

describe("visitTab", () => {
  it("adds a tab that has not been opened yet", () => {
    const visited = visitTab(new Set(["chats"]), "notes");
    expect([...visited]).toEqual(["chats", "notes"]);
  });

  it("moves an earlier tab to the most recent position", () => {
    const visited: ReadonlySet<"chats" | "notes" | "dms"> = new Set(["chats", "notes", "dms"]);
    expect([...visitTab(visited, "chats")]).toEqual(["notes", "dms", "chats"]);
  });

  it("returns the same set when the tab is already most recent", () => {
    const visited: ReadonlySet<"chats" | "notes"> = new Set(["chats", "notes"]);
    expect(visitTab(visited, "notes")).toBe(visited);
  });

  it("evicts the least recently used tab once the retained set is full", () => {
    type Tab = "chats" | "dms" | "notes" | "threads" | "you";
    let visited: ReadonlySet<Tab> = new Set<Tab>(["chats"]);
    for (const tab of ["dms", "notes", "threads", "you"] as const) {
      visited = visitTab(visited, tab);
    }
    expect(visited.size).toBe(MAX_RETAINED_TABS);
    expect(visited.has("chats")).toBe(false);
    expect(visited.has("dms")).toBe(false);
    expect([...visited]).toEqual(["notes", "threads", "you"]);

    // Revisiting the oldest retained tab makes it the most recent, so the next
    // new tab evicts `threads` instead of insertion-order `notes`.
    visited = visitTab(visited, "notes");
    visited = visitTab(visited, "chats");
    expect([...visited]).toEqual(["you", "notes", "chats"]);
  });

  it("does not mutate the set it was given", () => {
    const original = new Set<"chats" | "notes">(["chats"]);
    visitTab(original, "notes");
    expect([...original]).toEqual(["chats"]);
  });
});

describe("expireHiddenTabs", () => {
  it("keeps only the visible tab when the hidden lifetime ends", () => {
    expect([...expireHiddenTabs(new Set(["threads", "notes", "you"]), "you")]).toEqual(["you"]);
    expect(HIDDEN_TAB_TTL_MS).toBe(60_000);
  });

  it("leaves the set alone when the visible tab is missing", () => {
    const visited = new Set(["notes", "threads"]);
    expect(expireHiddenTabs(visited, "you")).toBe(visited);
  });
});

describe("mountedTabs", () => {
  const tabs = ["chats", "dms", "notes", "threads", "you"] as const;

  it("mounts the active tab and every visited tab in dock order", () => {
    const visited = new Set<(typeof tabs)[number]>(["chats", "notes", "threads"]);
    expect(mountedTabs(tabs, "threads", visited)).toEqual(["chats", "notes", "threads"]);
  });

  it("keeps the active tab even when it was not recorded as visited", () => {
    expect(mountedTabs(tabs, "dms", new Set())).toEqual(["dms"]);
  });

  it("drops a visited tab the dock no longer offers", () => {
    // An addon permission was removed mid-session; `boards` is not in `tabs`.
    const visited = new Set<(typeof tabs)[number] | "boards">(["chats", "boards"]);
    expect(mountedTabs(tabs, "chats", visited)).toEqual(["chats"]);
  });
});

describe("threadsInboxVisible", () => {
  it("is visible only when Threads is the tab on screen in the hub pane", () => {
    expect(threadsInboxVisible("threads", 0)).toBe(true);
    expect(threadsInboxVisible("threads", 1)).toBe(false);
    expect(threadsInboxVisible("chats", 0)).toBe(false);
  });
});
