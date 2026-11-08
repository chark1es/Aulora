import type { MentionTarget } from "@aulora/core";
import { describe, expect, it, vi } from "vitest";
import { mentionTargetsFor, mergeMentionTargets } from "../components/chat/mention-directory";

const person = (userId: string, displayName: string): MentionTarget => ({ userId, displayName });
const ids = (targets: readonly MentionTarget[]) => targets.map((target) => target.userId);

describe("mergeMentionTargets", () => {
  it("keeps the people already known ahead of directory results, once each", () => {
    const merged = mergeMentionTargets(
      [person("a", "Ada"), person("b", "Bo")],
      [person("b", "Bo (directory)"), person("c", "Cy")],
    );
    expect(ids(merged)).toEqual(["a", "b", "c"]);
    expect(merged.find((target) => target.userId === "b")?.displayName).toBe("Bo");
  });
});

describe("mentionTargetsFor", () => {
  const members = [person("a", "Ada")];

  it("returns the known members when there is no directory to ask", async () => {
    expect(await mentionTargetsFor("hi @Zed", members, undefined)).toBe(members);
  });

  it("does not ask the directory when every typed name is already known", async () => {
    const search = vi.fn(async () => []);
    expect(await mentionTargetsFor("hi @ada and @everyone @here", members, search)).toBe(members);
    expect(search).not.toHaveBeenCalled();
  });

  it("looks up a typed name the composer does not know", async () => {
    const search = vi.fn(async (query: string) => [person("z", query)]);
    const targets = await mentionTargetsFor("ping @Zed please", members, search);
    expect(search).toHaveBeenCalledWith("Zed");
    expect(ids(targets)).toEqual(["a", "z"]);
  });

  it("asks once per distinct name and caps how many it resolves", async () => {
    const search = vi.fn(async (query: string) => [person(query, query)]);
    const names = Array.from({ length: 12 }, (_, i) => `@n${i}`);
    const text = [...names, "@n0"].join(" ");
    await mentionTargetsFor(text, members, search);
    expect(search).toHaveBeenCalledTimes(8);
  });

  it("falls back to the known members when the lookup fails", async () => {
    const search = vi.fn(async () => {
      throw new Error("down");
    });
    expect(await mentionTargetsFor("@Zed", members, search)).toBe(members);
  });
});
