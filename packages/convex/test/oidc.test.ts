import { describe, expect, it } from "vitest";
import { extractGroups, parseGroupRoleMap, roleNamesForGroups } from "../convex/lib/oidc";

describe("parseGroupRoleMap", () => {
  it("accepts a string or an array value per group", () => {
    expect(parseGroupRoleMap('{"aulora-admins":"Admin","aulora-mods":["Mod","Helper"]}')).toEqual({
      "aulora-admins": ["Admin"],
      "aulora-mods": ["Mod", "Helper"],
    });
  });

  it("degrades malformed input to an empty map", () => {
    expect(parseGroupRoleMap(undefined)).toEqual({});
    expect(parseGroupRoleMap("not-json")).toEqual({});
    expect(parseGroupRoleMap("[1,2,3]")).toEqual({});
    expect(parseGroupRoleMap('{"empty":[],"spaces":"  "}')).toEqual({});
  });
});

describe("extractGroups", () => {
  it("reads arrays and delimited strings", () => {
    expect(extractGroups({ groups: ["a", "b"] }, "groups")).toEqual(["a", "b"]);
    expect(extractGroups({ groups: "a, b c" }, "groups")).toEqual(["a", "b", "c"]);
    expect(extractGroups({}, "groups")).toEqual([]);
    expect(extractGroups({ groups: ["a"] }, undefined)).toEqual([]);
  });
});

describe("roleNamesForGroups", () => {
  it("maps groups to deduplicated role names", () => {
    const map = parseGroupRoleMap('{"admins":"Admin","ops":["Admin","Helper"]}');
    expect(roleNamesForGroups(["admins", "ops", "unknown"], map)).toEqual(["Admin", "Helper"]);
  });
});
