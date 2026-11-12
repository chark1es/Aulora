import { describe, expect, it } from "vitest";
import { visitTab } from "../src/lib/visited-tabs";

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
