import { Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import {
  canEditChannelRole,
  manageableChannelRoles,
  mergeRoleOverrides,
  type OverrideView,
  overrideLevel,
  roleOverridesFor,
  sameOverrides,
  setOverrideLevel,
} from "../src/lib/channel-role-overrides";

const blocked: OverrideView = {
  targetId: "user-2",
  targetType: "member",
  allow: 0n,
  deny: Permission.ViewChannel,
};
const modRole: OverrideView = {
  targetId: "mod",
  targetType: "role",
  allow: Permission.SendMessages,
  deny: 0n,
};
const highRole: OverrideView = {
  targetId: "high",
  targetType: "role",
  allow: Permission.ViewChannel,
  deny: 0n,
};

describe("message channel role overrides", () => {
  it("reads and writes one flag without touching its opposite", () => {
    const target = { targetId: "mod", targetType: "role" as const };
    expect(overrideLevel([modRole], target, "SendMessages")).toBe("allow");
    expect(overrideLevel([modRole], target, "AddReactions")).toBe("inherit");

    const denied = setOverrideLevel([modRole], target, "SendMessages", "deny");
    expect(denied).toEqual([
      { targetId: "mod", targetType: "role", allow: 0n, deny: Permission.SendMessages },
    ]);

    const cleared = setOverrideLevel(denied, target, "SendMessages", "inherit");
    expect(cleared).toEqual([]);
  });

  it("preserves member and unmanaged role overrides when merging", () => {
    const merged = mergeRoleOverrides(
      [blocked, modRole, highRole],
      [{ targetId: "mod", targetType: "role", allow: 0n, deny: Permission.ViewChannel }],
      new Set(["mod"]),
    );
    expect(merged).toEqual([
      blocked,
      highRole,
      { targetId: "mod", targetType: "role", allow: 0n, deny: Permission.ViewChannel },
    ]);
  });

  it("extracts role overrides and compares sets order-insensitively", () => {
    expect(roleOverridesFor([blocked, modRole, highRole])).toEqual([modRole, highRole]);
    expect(sameOverrides([blocked, modRole], [modRole, blocked])).toBe(true);
    expect(sameOverrides([modRole], [{ ...modRole, allow: Permission.ManageChannels }])).toBe(
      false,
    );
  });

  it("mirrors the server hierarchy when listing manageable roles", () => {
    const roles = [
      {
        id: "@everyone",
        key: "@everyone",
        name: "@everyone",
        color: null,
        position: 0,
        isEveryone: true,
      },
      { id: "junior", key: "junior", name: "Junior", color: null, position: 2, isEveryone: false },
      { id: "high", key: "high", name: "High", color: null, position: 9, isEveryone: false },
    ];
    const manageable = manageableChannelRoles(roles, { isOwner: false, topPosition: 5 });
    expect(manageable.map((role) => role.id)).toEqual(["@everyone", "junior"]);
    expect(
      canEditChannelRole(
        { isOwner: false, topPosition: 5 },
        { id: "high", name: "High", position: 9 },
      ),
    ).toBe(false);
  });

  it("lets the owner manage every role", () => {
    const roles = [
      { id: "high", key: "high", name: "High", color: null, position: 9, isEveryone: false },
    ];
    expect(
      manageableChannelRoles(roles, { isOwner: true, topPosition: Number.POSITIVE_INFINITY }),
    ).toHaveLength(1);
  });
});
