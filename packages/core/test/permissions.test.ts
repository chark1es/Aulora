import { describe, expect, it } from "vitest";
import {
  ADMINISTRATOR,
  ALL_PERMISSIONS,
  canGrantPermissions,
  canManageRole,
  canModerate,
  canModerateMember,
  EVERYONE_ROLE_ID,
  hasPermission,
  highestRolePosition,
  type Overwrite,
  PERMISSION_NAMES,
  Permission,
  permissionNames,
  permissionsFromNames,
  type Role,
  resolvePermissions,
} from "../src/permissions";

const EVERYONE: Role = {
  id: EVERYONE_ROLE_ID,
  position: 0,
  permissions: Permission.ViewChannel | Permission.SendMessages | Permission.ReadHistory,
};
const MOD: Role = {
  id: "mod",
  position: 5,
  permissions: Permission.Kick | Permission.ManageMessages,
};
const ADMIN: Role = {
  id: "admin",
  position: 10,
  permissions: Permission.Administrator | Permission.Ban,
};
const ROLES: Role[] = [EVERYONE, MOD, ADMIN];

const overwrite = (
  targetType: "role" | "member",
  targetId: string,
  allow: bigint,
  deny: bigint,
): Overwrite => ({ targetType, targetId, allow, deny });

describe("Permission bitfield", () => {
  it("defines exactly the documented flags", () => {
    expect(PERMISSION_NAMES).toEqual([
      "ViewChannel",
      "ManageChannels",
      "ManageRoles",
      "ManageWorkspace",
      "ViewAuditLog",
      "CreateInvites",
      "ManageEmoji",
      "Kick",
      "Ban",
      "Timeout",
      "ChangeOwnNickname",
      "ManageNicknames",
      "SendMessages",
      "SendInThreads",
      "CreateThreads",
      "AttachFiles",
      "EmbedLinks",
      "AddReactions",
      "MentionEveryone",
      "ManageMessages",
      "PinMessages",
      "ReadHistory",
      "Administrator",
      "Connect",
      "Speak",
      "Stream",
      "UseVideo",
      "MuteMembers",
      "DeafenMembers",
      "MoveMembers",
      "ViewKanban",
      "EditKanban",
      "CommentKanban",
      "ManageKanban",
      "ViewNotes",
      "CreateNotes",
      "EditNotes",
      "DeleteNotes",
      "ManageNotes",
    ]);
    expect(PERMISSION_NAMES).toHaveLength(39);
  });

  it("gives every flag exactly one independent bit", () => {
    let seen = 0n;
    for (const name of PERMISSION_NAMES) {
      const flag = Permission[name];
      expect(flag > 0n).toBe(true);
      expect((flag & (flag - 1n)) === 0n, `${name} must be a single bit`).toBe(true);
      expect((seen & flag) === 0n, `${name} must not collide`).toBe(true);
      seen |= flag;
    }
    expect(seen).toBe(ALL_PERMISSIONS);
  });

  it("exposes Administrator as the top flag and a helper", () => {
    expect(ADMINISTRATOR).toBe(1n << 22n);
    expect(hasPermission(Permission.Ban, Permission.Ban)).toBe(true);
    expect(hasPermission(Permission.Ban, Permission.Kick)).toBe(false);
    expect(hasPermission(Permission.Ban, Permission.Administrator)).toBe(false);
    expect(hasPermission(Permission.Administrator, Permission.Kick)).toBe(true);
    expect(permissionNames(Permission.Kick | Permission.Ban)).toEqual(["Kick", "Ban"]);
    expect(permissionsFromNames(["Kick", "Ban"])).toBe(Permission.Kick | Permission.Ban);
  });
});

describe("resolvePermissions — base roles", () => {
  it("grants everything to the workspace owner", () => {
    const result = resolvePermissions({
      actor: { userId: "u1", roleIds: [], isOwner: true },
      roles: ROLES,
    });
    expect(result).toBe(ALL_PERMISSIONS);
  });

  it("grants everything to an Administrator, ignoring overwrites", () => {
    const result = resolvePermissions({
      actor: { userId: "u1", roleIds: ["admin"] },
      roles: ROLES,
      channelOverrides: [overwrite("role", "admin", 0n, ALL_PERMISSIONS)],
    });
    expect(result).toBe(ALL_PERMISSIONS);
  });

  it("starts from @everyone and ORs in held roles", () => {
    const result = resolvePermissions({
      actor: { userId: "u1", roleIds: ["mod"] },
      roles: ROLES,
    });
    expect(hasPermission(result, Permission.ViewChannel)).toBe(true);
    expect(hasPermission(result, Permission.Kick)).toBe(true);
    expect(hasPermission(result, Permission.ManageMessages)).toBe(true);
    expect(hasPermission(result, Permission.Ban)).toBe(false);
  });

  it("gives a role-less member the @everyone baseline", () => {
    const result = resolvePermissions({ actor: { userId: "u1", roleIds: [] }, roles: ROLES });
    expect(result).toBe(EVERYONE.permissions);
  });

  it("recognizes @everyone by id or by the isEveryone marker", () => {
    const customEveryone: Role = {
      id: "custom-default",
      position: 0,
      permissions: Permission.ViewChannel,
      isEveryone: true,
    };
    const result = resolvePermissions({
      actor: { userId: "u1", roleIds: [] },
      roles: [customEveryone, MOD],
    });
    expect(result).toBe(Permission.ViewChannel);
  });
});

describe("resolvePermissions — overwrite order", () => {
  const actor = { userId: "alice", roleIds: ["mod"] };
  const SEND = Permission.SendMessages;

  it("applies a category role deny", () => {
    const result = resolvePermissions({
      actor,
      roles: ROLES,
      categoryOverrides: [overwrite("role", "mod", 0n, SEND)],
    });
    expect(hasPermission(result, SEND)).toBe(false);
  });

  it("applies role allows after role denies regardless of array order", () => {
    const result = resolvePermissions({
      actor,
      roles: ROLES,
      channelOverrides: [overwrite("role", "mod", SEND, 0n), overwrite("role", "mod", 0n, SEND)],
    });
    expect(hasPermission(result, SEND)).toBe(true);
  });

  it("applies member denies after role allows", () => {
    const result = resolvePermissions({
      actor,
      roles: ROLES,
      channelOverrides: [
        overwrite("role", "mod", SEND, 0n),
        overwrite("member", "alice", 0n, SEND),
      ],
    });
    expect(hasPermission(result, SEND)).toBe(false);
  });

  it("applies member allows after member denies", () => {
    const result = resolvePermissions({
      actor,
      roles: ROLES,
      channelOverrides: [
        overwrite("member", "alice", 0n, SEND),
        overwrite("member", "alice", SEND, 0n),
      ],
    });
    expect(hasPermission(result, SEND)).toBe(true);
  });

  it("applies channel overrides after category overrides", () => {
    const result = resolvePermissions({
      actor,
      roles: ROLES,
      categoryOverrides: [overwrite("role", "mod", SEND, 0n)],
      channelOverrides: [overwrite("role", "mod", 0n, SEND)],
    });
    expect(hasPermission(result, SEND)).toBe(false);
  });

  it("lets a later channel role allow undo a category role deny", () => {
    const result = resolvePermissions({
      actor,
      roles: ROLES,
      categoryOverrides: [overwrite("role", "mod", 0n, SEND)],
      channelOverrides: [overwrite("role", "mod", SEND, 0n)],
    });
    expect(hasPermission(result, SEND)).toBe(true);
  });

  it("ignores overrides for roles the actor does not hold", () => {
    const result = resolvePermissions({
      actor,
      roles: ROLES,
      channelOverrides: [overwrite("role", "admin", 0n, SEND)],
    });
    expect(hasPermission(result, SEND)).toBe(true);
  });

  it("applies @everyone role overwrites to every member", () => {
    const result = resolvePermissions({
      actor,
      roles: ROLES,
      channelOverrides: [overwrite("role", EVERYONE_ROLE_ID, 0n, SEND)],
    });
    expect(hasPermission(result, SEND)).toBe(false);
  });

  it("can grant a permission that is not in any base role", () => {
    const result = resolvePermissions({
      actor,
      roles: ROLES,
      channelOverrides: [overwrite("member", "alice", Permission.MentionEveryone, 0n)],
    });
    expect(hasPermission(result, Permission.MentionEveryone)).toBe(true);
  });

  it("does not drop ViewChannel unless a deny removes it", () => {
    const result = resolvePermissions({
      actor,
      roles: ROLES,
      categoryOverrides: [overwrite("member", "bob", 0n, Permission.ViewChannel)],
    });
    expect(hasPermission(result, Permission.ViewChannel)).toBe(true);
  });

  it("runs all four stages per scope with channel overrides applied last", () => {
    const result = resolvePermissions({
      actor,
      roles: ROLES,
      categoryOverrides: [
        overwrite("role", "mod", 0n, SEND),
        overwrite("role", "mod", SEND, 0n),
        overwrite("member", "alice", 0n, SEND),
        overwrite("member", "alice", 0n, SEND),
      ],
      channelOverrides: [
        overwrite("role", "mod", 0n, SEND),
        overwrite("role", "mod", 0n, SEND),
        overwrite("member", "alice", 0n, SEND),
        overwrite("member", "alice", SEND, 0n),
      ],
    });
    expect(hasPermission(result, SEND)).toBe(true);
  });

  it("lets a channel member allow re-grant what the category member deny removed", () => {
    const result = resolvePermissions({
      actor,
      roles: ROLES,
      categoryOverrides: [overwrite("member", "alice", 0n, SEND)],
      channelOverrides: [overwrite("member", "alice", SEND, 0n)],
    });
    expect(hasPermission(result, SEND)).toBe(true);
  });
});

describe("grant ceiling and role management", () => {
  it("allows granting only permissions the actor already holds", () => {
    const held = Permission.Kick | Permission.ViewChannel;
    expect(canGrantPermissions(held, Permission.Kick)).toBe(true);
    expect(canGrantPermissions(held, held)).toBe(true);
    expect(canGrantPermissions(held, Permission.Ban)).toBe(false);
    expect(canGrantPermissions(held, Permission.Kick | Permission.Ban)).toBe(false);
    expect(canGrantPermissions(0n, Permission.ViewChannel)).toBe(false);
  });

  it("lets an Administrator grant anything", () => {
    expect(canGrantPermissions(Permission.Administrator, ALL_PERMISSIONS)).toBe(true);
    expect(canGrantPermissions(Permission.Administrator | Permission.Ban, Permission.Kick)).toBe(
      true,
    );
  });

  it("only lets an actor manage roles strictly below their top role", () => {
    const actor = { userId: "a", topRolePosition: 5 };
    expect(canManageRole(actor, 4)).toBe(true);
    expect(canManageRole(actor, 0)).toBe(true);
    expect(canManageRole(actor, 5)).toBe(false);
    expect(canManageRole(actor, 6)).toBe(false);
    expect(canManageRole({ userId: "a", topRolePosition: -1 }, 0)).toBe(false);
  });

  it("lets an owner manage any role, including one above their roles", () => {
    expect(canManageRole({ userId: "a", topRolePosition: -1, isOwner: true }, 100)).toBe(true);
  });
});

describe("hierarchy", () => {
  it("requires the actor's top role to be strictly above the target's", () => {
    expect(
      canModerate({ userId: "a", topRolePosition: 10 }, { userId: "b", topRolePosition: 5 }),
    ).toBe(true);
    expect(
      canModerate({ userId: "a", topRolePosition: 5 }, { userId: "b", topRolePosition: 10 }),
    ).toBe(false);
    expect(
      canModerate({ userId: "a", topRolePosition: 5 }, { userId: "b", topRolePosition: 5 }),
    ).toBe(false);
  });

  it("never lets anyone moderate themselves", () => {
    expect(
      canModerate({ userId: "a", topRolePosition: 10 }, { userId: "a", topRolePosition: 0 }),
    ).toBe(false);
  });

  it("protects owners and lets an owner moderate anyone else", () => {
    expect(
      canModerate(
        { userId: "a", topRolePosition: 100 },
        { userId: "b", topRolePosition: 99, isOwner: true },
      ),
    ).toBe(false);
    expect(
      canModerate(
        { userId: "a", topRolePosition: 0, isOwner: true },
        { userId: "b", topRolePosition: 100 },
      ),
    ).toBe(true);
    expect(
      canModerate(
        { userId: "a", topRolePosition: 100, isOwner: true },
        { userId: "b", topRolePosition: 100, isOwner: true },
      ),
    ).toBe(false);
  });

  it("derives top positions from roles", () => {
    expect(highestRolePosition(["mod"], ROLES)).toBe(5);
    expect(highestRolePosition(["mod", "admin"], ROLES)).toBe(10);
    expect(highestRolePosition([], ROLES)).toBe(-1);
    expect(
      canModerateMember({
        actor: { userId: "a", roleIds: ["admin"] },
        target: { userId: "b", roleIds: ["mod"] },
        roles: ROLES,
      }),
    ).toBe(true);
    expect(
      canModerateMember({
        actor: { userId: "a", roleIds: ["mod"] },
        target: { userId: "b", roleIds: ["admin"] },
        roles: ROLES,
      }),
    ).toBe(false);
  });
});
