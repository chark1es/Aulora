import { ALL_PERMISSIONS, EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import {
  canManageRoleUi,
  canModerateUi,
  heldRoleIds,
  memberDisplayName,
  overrideLevel,
  type RoleView,
  resolveViewerPermissions,
  roleColorFor,
  roleRef,
  setOverrideLevel,
  togglePermissionBit,
  topPositionForRefs,
  topRole,
} from "../lib/workspace-admin";

function role(partial: Partial<RoleView> & { name: string; position: number }): RoleView {
  const { name, ...rest } = partial;
  return {
    id: name,
    key: null,
    name,
    color: null,
    permissions: 0n,
    hoisted: false,
    mentionable: false,
    isEveryone: false,
    ...rest,
  };
}

const everyone: RoleView = role({
  name: "@everyone",
  position: 0,
  key: EVERYONE_ROLE_ID,
  isEveryone: true,
  permissions: Permission.ViewChannel | Permission.SendMessages,
});
const moderator = role({
  name: "Moderator",
  position: 5,
  color: "#F5A45B",
  permissions: Permission.Kick | Permission.ManageMessages,
});
const admin = role({
  name: "Admin",
  position: 9,
  color: "#8FD19E",
  permissions: Permission.Administrator,
});
const undyed = role({ name: "Undyed", position: 7, color: null });

const roles = [admin, undyed, moderator, everyone];

describe("workspace-admin helpers", () => {
  it("derives the stable role reference and always includes @everyone", () => {
    expect(roleRef(moderator)).toBe("Moderator");
    expect(roleRef({ id: "abc", key: null })).toBe("abc");
    const held = heldRoleIds({ userId: "u1", roleIds: [], joinedAt: 0 } as never, roles);
    expect(held).toContain(EVERYONE_ROLE_ID);
  });

  it("resolves owner permissions to every flag", () => {
    const bits = resolveViewerPermissions({
      viewer: { userId: "owner", isOwner: true },
      member: null,
      roles,
    });
    expect(bits).toBe(ALL_PERMISSIONS);
  });

  it("ORs held roles and honors overrides", () => {
    const member = {
      id: "m1",
      userId: "u1",
      nickname: null,
      roleIds: [EVERYONE_ROLE_ID, "Moderator"],
      joinedAt: 0,
      timeoutUntil: null,
    };
    const bits = resolveViewerPermissions({
      viewer: { userId: "u1", isOwner: false },
      member,
      roles,
    });
    expect(bits & Permission.Kick).toBeTruthy();
    expect(bits & Permission.SendMessages).toBeTruthy();

    const denied = resolveViewerPermissions({
      viewer: { userId: "u1", isOwner: false },
      member,
      roles,
      channelOverrides: [
        { targetId: "Moderator", targetType: "role", allow: 0n, deny: Permission.SendMessages },
      ],
    });
    expect(denied & Permission.SendMessages).toBeFalsy();
  });

  it("picks the highest colored role for the ring", () => {
    const member = {
      id: "m1",
      userId: "u1",
      nickname: null,
      roleIds: [EVERYONE_ROLE_ID, "Moderator", "Admin"],
      joinedAt: 0,
      timeoutUntil: null,
    };
    expect(topRole(member, roles)?.name).toBe("Admin");
    expect(roleColorFor(member, roles)).toBe("#8FD19E");
  });

  it("falls back when no colored role is held", () => {
    const member = {
      id: "m1",
      userId: "u1",
      nickname: null,
      roleIds: ["Undyed"],
      joinedAt: 0,
      timeoutUntil: null,
    };
    expect(roleColorFor(member, roles)).toBeNull();
  });

  it("prefers a nickname for display", () => {
    const member = {
      id: "m1",
      userId: "u1",
      nickname: "Ace",
      roleIds: [],
      joinedAt: 0,
      timeoutUntil: null,
    };
    expect(memberDisplayName(member, "Base")).toBe("Ace");
    expect(memberDisplayName(null, "Base")).toBe("Base");
  });

  it("toggles permission bits", () => {
    const on = togglePermissionBit(0n, "Kick", true);
    expect(on).toBe(Permission.Kick);
    expect(togglePermissionBit(on, "Kick", false)).toBe(0n);
  });

  it("gates role management by hierarchy and @everyone", () => {
    expect(canManageRoleUi({ isOwner: false, topPosition: 6 }, moderator)).toBe(true);
    expect(canManageRoleUi({ isOwner: false, topPosition: 5 }, moderator)).toBe(false);
    expect(
      canManageRoleUi({ isOwner: true, topPosition: Number.POSITIVE_INFINITY }, everyone),
    ).toBe(false);
  });

  it("gates moderation by owner and hierarchy", () => {
    const base = {
      viewer: { userId: "u1", isOwner: false, roleIds: [EVERYONE_ROLE_ID, "Moderator"] },
      roles,
    };
    expect(
      canModerateUi({
        ...base,
        target: { userId: "u2", isOwner: false, roleIds: [EVERYONE_ROLE_ID] },
      }),
    ).toBe(true);
    expect(
      canModerateUi({
        ...base,
        target: { userId: "u3", isOwner: false, roleIds: ["Admin"] },
      }),
    ).toBe(false);
    expect(
      canModerateUi({
        ...base,
        target: { userId: "u4", isOwner: true, roleIds: [] },
      }),
    ).toBe(false);
    expect(
      canModerateUi({
        ...base,
        target: { userId: "u1", isOwner: false, roleIds: [] },
      }),
    ).toBe(false);
  });

  it("computes a top position from role refs", () => {
    expect(topPositionForRefs([EVERYONE_ROLE_ID, "Undyed"], roles)).toBe(7);
    expect(topPositionForRefs([], roles)).toBe(0);
  });

  it("applies override levels with disjoint allow/deny", () => {
    let overrides = setOverrideLevel(
      [],
      { targetId: "Moderator", targetType: "role" },
      "Kick",
      "allow",
    );
    expect(overrideLevel(overrides, { targetId: "Moderator", targetType: "role" }, "Kick")).toBe(
      "allow",
    );
    overrides = setOverrideLevel(
      overrides,
      { targetId: "Moderator", targetType: "role" },
      "Kick",
      "deny",
    );
    const entry = overrides.find((item) => item.targetId === "Moderator");
    expect((entry?.allow ?? 0n) & Permission.Kick).toBeFalsy();
    expect((entry?.deny ?? 0n) & Permission.Kick).toBeTruthy();
    overrides = setOverrideLevel(
      overrides,
      { targetId: "Moderator", targetType: "role" },
      "Kick",
      "inherit",
    );
    expect(overrides).toHaveLength(0);
  });
});
