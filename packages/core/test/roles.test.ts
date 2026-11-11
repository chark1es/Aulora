import { describe, expect, it } from "vitest";
import { EVERYONE_ROLE_ID, Permission } from "../src/permissions";
import {
  canManageChannels,
  heldRoleIds,
  type MemberView,
  memberDisplayName,
  type RoleView,
  resolveViewerPermissions,
  toCoreRoles,
} from "../src/roles";

const everyone: RoleView = {
  id: "everyone",
  key: EVERYONE_ROLE_ID,
  name: "@everyone",
  color: null,
  position: 0,
  permissions: Permission.ViewChannel,
  hoisted: false,
  mentionable: false,
  isEveryone: true,
};

const mod: RoleView = {
  id: "role-mod",
  key: "mod",
  name: "Moderator",
  color: "#8FD19E",
  position: 5,
  permissions: Permission.Kick,
  hoisted: true,
  mentionable: true,
  isEveryone: false,
};

const admin: RoleView = {
  id: "role-admin",
  key: null,
  name: "Admin",
  color: "#FF0000",
  position: 9,
  permissions: Permission.ManageChannels,
  hoisted: true,
  mentionable: true,
  isEveryone: false,
};

const member: MemberView = {
  id: "member-1",
  userId: "alex",
  nickname: null,
  roleIds: ["mod", "role-admin"],
  joinedAt: 1,
  timeoutUntil: null,
};

describe("role views", () => {
  it("maps views onto the core role shape", () => {
    expect(toCoreRoles([mod])).toEqual([
      {
        id: "mod",
        position: 5,
        permissions: Permission.Kick,
        isEveryone: false,
      },
    ]);
  });

  it("always includes @everyone in the held role ids", () => {
    expect(heldRoleIds(member, [everyone, mod])).toEqual(["mod", "role-admin", EVERYONE_ROLE_ID]);
    expect(heldRoleIds(null, [])).toEqual([EVERYONE_ROLE_ID]);
  });

  it("resolves the same bitfield the server enforces", () => {
    expect(
      resolveViewerPermissions({
        viewer: { userId: "alex", isOwner: false },
        member,
        roles: [everyone, mod, admin],
      }),
    ).toBe(Permission.ViewChannel | Permission.Kick | Permission.ManageChannels);
  });

  it("applies category and channel overrides", () => {
    const denied = resolveViewerPermissions({
      viewer: { userId: "alex", isOwner: false },
      member,
      roles: [everyone],
      channelOverrides: [
        { targetId: "alex", targetType: "member", allow: 0n, deny: Permission.ViewChannel },
      ],
    });
    expect(denied & Permission.ViewChannel).toBe(0n);
  });

  it("lets an owner manage channels without the bit", () => {
    expect(canManageChannels(true, 0n)).toBe(true);
    expect(canManageChannels(false, Permission.ManageChannels)).toBe(true);
    expect(canManageChannels(false, 0n)).toBe(false);
  });

  it("prefers nickname, then account name, then fallback", () => {
    expect(memberDisplayName({ ...member, nickname: "Ace" }, "Base")).toBe("Ace");
    expect(memberDisplayName({ ...member, accountName: "Ada" }, "Base")).toBe("Ada");
    expect(memberDisplayName(member, "Base")).toBe("Base");
    expect(memberDisplayName(null, "Base")).toBe("Base");
  });
});
