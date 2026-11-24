import { describe, expect, it } from "vitest";
import { withoutBots } from "../src/bots";

describe("withoutBots", () => {
  it("keeps people and drops bot accounts, preserving order", () => {
    const members = [
      { userId: "u1", displayName: "Ada" },
      { userId: "bot_k57abc", displayName: "Helper" },
      { userId: "u2", displayName: "Grace" },
    ];
    expect(withoutBots(members).map((member) => member.userId)).toEqual(["u1", "u2"]);
  });

  it("keeps a bot that is already selected so it can be removed", () => {
    const members = [
      { userId: "u1", displayName: "Ada" },
      { userId: "bot_k57abc", displayName: "Helper" },
    ];
    expect(withoutBots(members, ["bot_k57abc"]).map((member) => member.userId)).toEqual([
      "u1",
      "bot_k57abc",
    ]);
  });
});
