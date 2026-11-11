import { describe, expect, it } from "vitest";
import { buildPresenceScope, PRESENCE_SCOPE_MAX } from "../src/index";

describe("buildPresenceScope", () => {
  it("unions the timeline authors, displayed members, own user and DM partners", () => {
    const scope = buildPresenceScope({
      ownUserId: "me",
      timelineAuthorIds: ["a", "b", "a"],
      displayedMemberIds: ["b", "c"],
      channels: [
        { kind: "dm", memberIds: ["me", "d"] },
        { kind: "text", memberIds: ["me", "e"] },
      ],
    });
    expect(scope).toEqual(["me", "a", "b", "c", "d"]);
  });

  it("appends extra ids after the timeline and member set", () => {
    const scope = buildPresenceScope({
      ownUserId: "me",
      timelineAuthorIds: ["a"],
      displayedMemberIds: [],
      channels: [],
      extraUserIds: ["x", "a"],
    });
    expect(scope).toEqual(["me", "a", "x"]);
  });

  it("caps the scope at the server's id ceiling, keeping render order", () => {
    const many = Array.from({ length: PRESENCE_SCOPE_MAX + 25 }, (_, index) => `u${index}`);
    const scope = buildPresenceScope({
      ownUserId: "me",
      timelineAuthorIds: many,
      displayedMemberIds: [],
      channels: [],
    });
    expect(scope).toHaveLength(PRESENCE_SCOPE_MAX);
    expect(scope[0]).toBe("me");
    expect(scope.at(-1)).toBe(`u${PRESENCE_SCOPE_MAX - 2}`);
  });
});
describe("buildPresenceScope", () => {
  it("unions the timeline authors, displayed members, own user and DM partners", () => {
    const scope = buildPresenceScope({
      ownUserId: "me",
      timelineAuthorIds: ["a", "b", "a"],
      displayedMemberIds: ["b", "c"],
      channels: [
        { kind: "dm", memberIds: ["me", "d"] },
        { kind: "text", memberIds: ["me", "e"] },
      ],
    });
    expect(scope).toEqual(["me", "a", "b", "c", "d"]);
  });

  it("appends extra ids after the timeline and member set", () => {
    const scope = buildPresenceScope({
      ownUserId: "me",
      timelineAuthorIds: ["a"],
      displayedMemberIds: [],
      channels: [],
      extraUserIds: ["x", "a"],
    });
    expect(scope).toEqual(["me", "a", "x"]);
  });

  it("caps the scope at the server's id ceiling, keeping render order", () => {
    const many = Array.from({ length: PRESENCE_SCOPE_MAX + 25 }, (_, index) => `u${index}`);
    const scope = buildPresenceScope({
      ownUserId: "me",
      timelineAuthorIds: many,
      displayedMemberIds: [],
      channels: [],
    });
    expect(scope).toHaveLength(PRESENCE_SCOPE_MAX);
    expect(scope[0]).toBe("me");
    expect(scope.at(-1)).toBe(`u${PRESENCE_SCOPE_MAX - 2}`);
  });
});
