import { describe, expect, it } from "vitest";
import { mountedTabs, threadsInboxVisible, visitTab } from "../src/lib/visited-tabs";

describe("visitTab", () => {
  it("adds a tab that has not been opened yet", () => {
    const visited = visitTab(new Set(["chats"]), "notes");
    expect([...visited]).toEqual(["chats", "notes"]);
  });

  it("returns the same set when the tab was already visited", () => {
    const visited: ReadonlySet<"chats" | "notes"> = new Set(["chats", "notes"]);
    expect(visitTab(visited, "notes")).toBe(visited);
  });

  it("does not mutate the set it was given", () => {
    const original = new Set<"chats" | "notes">(["chats"]);
    visitTab(original, "notes");
    expect([...original]).toEqual(["chats"]);
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
