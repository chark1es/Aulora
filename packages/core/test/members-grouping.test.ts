import { describe, expect, it } from "vitest";
import { groupMembersByHoistedRole, type MembersGroupingRole } from "../src/members-grouping";

interface Member {
  readonly userId: string;
  readonly roleIds: readonly string[];
  readonly online: boolean;
}

function member(userId: string, roleIds: readonly string[], online = true): Member {
  return { userId, roleIds, online };
}

const isOnline = (entry: { readonly online: boolean }) => entry.online;
const ids = (entries: readonly { readonly userId: string }[]) =>
  entries.map((entry) => entry.userId);

const moderators: MembersGroupingRole = {
  id: "mod",
  name: "Moderators",
  color: "#f2545b",
  position: 5,
  hoisted: true,
};
const developers: MembersGroupingRole = {
  id: "dev",
  name: "Developers",
  color: "#6f5cff",
  position: 3,
  hoisted: true,
};
const plain: MembersGroupingRole = {
  id: "plain",
  name: "Plain",
  color: null,
  position: 1,
  hoisted: false,
};
const everyone: MembersGroupingRole = {
  id: "@everyone",
  name: "@everyone",
  color: null,
  position: 0,
  hoisted: true,
  isEveryone: true,
};

describe("groupMembersByHoistedRole", () => {
  it("splits online and offline with no hoisted roles", () => {
    const result = groupMembersByHoistedRole(
      [member("ada", ["plain"]), member("bob", ["plain"], false)],
      [plain],
      isOnline,
    );
    expect(result.sections).toEqual([]);
    expect(ids(result.online)).toEqual(["ada"]);
    expect(ids(result.offline)).toEqual(["bob"]);
  });

  it("puts only online members of a hoisted role in its section", () => {
    const result = groupMembersByHoistedRole(
      [
        member("ada", ["mod"]),
        member("bob", ["mod"], false),
        member("cy", []),
        member("dee", [], false),
      ],
      [moderators],
      isOnline,
    );
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.role).toBe(moderators);
    expect(ids(result.sections[0]?.members ?? [])).toEqual(["ada"]);
    expect(ids(result.online)).toEqual(["cy"]);
    expect(ids(result.offline)).toEqual(["bob", "dee"]);
  });

  it("orders sections by position, highest first", () => {
    const result = groupMembersByHoistedRole(
      [member("ada", ["dev"]), member("bob", ["mod"])],
      [developers, moderators],
      isOnline,
    );
    expect(result.sections.map((section) => section.role.id)).toEqual(["mod", "dev"]);
  });

  it("assigns a member to the highest hoisted role they hold", () => {
    const result = groupMembersByHoistedRole(
      [member("ada", ["dev", "mod"])],
      [developers, moderators],
      isOnline,
    );
    expect(ids(result.sections[0]?.members ?? [])).toEqual(["ada"]);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.role.id).toBe("mod");
  });

  it("uses the lower hoisted role when the member does not hold the higher one", () => {
    const result = groupMembersByHoistedRole(
      [member("ada", ["dev"])],
      [developers, moderators],
      isOnline,
    );
    expect(result.sections.map((section) => section.role.id)).toEqual(["dev"]);
  });

  it("never renders @everyone as a section even when hoisted", () => {
    const result = groupMembersByHoistedRole([member("ada", ["@everyone"])], [everyone], isOnline);
    expect(result.sections).toEqual([]);
    expect(ids(result.online)).toEqual(["ada"]);
  });

  it("never renders a role marked isEveryone as a section", () => {
    const result = groupMembersByHoistedRole(
      [member("ada", ["everyone-id"])],
      [
        {
          id: "everyone-id",
          name: "Everyone",
          color: null,
          position: 0,
          hoisted: true,
          isEveryone: true,
        },
      ],
      isOnline,
    );
    expect(result.sections).toEqual([]);
  });

  it("ignores roles without the hoist flag", () => {
    const result = groupMembersByHoistedRole([member("ada", ["plain"])], [plain], isOnline);
    expect(result.sections).toEqual([]);
    expect(ids(result.online)).toEqual(["ada"]);
  });

  it("drops empty hoisted sections", () => {
    const result = groupMembersByHoistedRole(
      [member("ada", ["dev"])],
      [developers, moderators],
      isOnline,
    );
    expect(result.sections.map((section) => section.role.id)).toEqual(["dev"]);
  });

  it("keeps the order members are given within a section", () => {
    const result = groupMembersByHoistedRole(
      [member("zed", ["mod"]), member("ada", ["mod"]), member("bob", ["mod"])],
      [moderators],
      isOnline,
    );
    expect(ids(result.sections[0]?.members ?? [])).toEqual(["zed", "ada", "bob"]);
  });

  it("treats repeated role ids as a single assignment", () => {
    const result = groupMembersByHoistedRole(
      [member("ada", ["mod", "mod"])],
      [moderators],
      isOnline,
    );
    expect(ids(result.sections[0]?.members ?? [])).toEqual(["ada"]);
  });

  it("handles members with an empty role list", () => {
    const result = groupMembersByHoistedRole([member("ada", [])], [moderators], isOnline);
    expect(result.sections).toEqual([]);
    expect(ids(result.online)).toEqual(["ada"]);
  });

  it("collapses every role into offline when nobody is online", () => {
    const result = groupMembersByHoistedRole(
      [member("ada", ["mod"], false), member("bob", ["dev"], false)],
      [developers, moderators],
      isOnline,
    );
    expect(result.sections).toEqual([]);
    expect(result.online).toEqual([]);
    expect(ids(result.offline)).toEqual(["ada", "bob"]);
  });

  it("matches members by the stable role ref they store", () => {
    const byKey: MembersGroupingRole = {
      id: "manager",
      name: "Manager",
      color: "#248a3d",
      position: 2,
      hoisted: true,
    };
    const result = groupMembersByHoistedRole([member("ada", ["manager"])], [byKey], isOnline);
    expect(ids(result.sections[0]?.members ?? [])).toEqual(["ada"]);
  });
});
