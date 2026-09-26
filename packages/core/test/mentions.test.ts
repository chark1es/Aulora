import { describe, expect, it } from "vitest";
import { expandBroadcast, resolveMentions } from "../src/chat/index.js";

const members = [
  { userId: "u-alice", displayName: "Alice" },
  { userId: "u-alice-smith", displayName: "Alice.Smith" },
  { userId: "u-bob", displayName: "Bob" },
];

describe("resolveMentions", () => {
  it("resolves a direct user mention", () => {
    expect(resolveMentions("hey @Bob can you look", members).userIds).toEqual(["u-bob"]);
  });

  it("prefers the longest matching display name", () => {
    expect(resolveMentions("@Alice.Smith ping", members).userIds).toEqual(["u-alice-smith"]);
  });

  it("does not mention on an email-like token", () => {
    expect(resolveMentions("mail me at a@Bob.com", members).userIds).toEqual([]);
  });

  it("flags @here and @everyone", () => {
    const result = resolveMentions("@here please review", members);
    expect(result.here).toBe(true);
    expect(result.everyone).toBe(false);
    expect(resolveMentions("@everyone ship it", members).everyone).toBe(true);
  });

  it("expands a mentionable role to its members", () => {
    const result = resolveMentions("@oncall please respond", members, [
      {
        roleId: "r-oncall",
        name: "oncall",
        mentionable: true,
        memberUserIds: ["u-alice", "u-bob"],
      },
    ]);
    expect(result.userIds).toEqual(["u-alice", "u-bob"]);
  });

  it("ignores unmentionable roles", () => {
    const result = resolveMentions("@admin fix", members, [
      { roleId: "r-admin", name: "admin", mentionable: false, memberUserIds: ["u-alice"] },
    ]);
    expect(result.userIds).toEqual([]);
  });

  it("expands broadcasts across every member", () => {
    const resolution = resolveMentions("@everyone hi", members);
    expect(
      expandBroadcast(
        resolution,
        members.map((m) => m.userId),
      ),
    ).toEqual(["u-alice", "u-alice-smith", "u-bob"]);
  });
});
