import { ALL_PERMISSIONS, EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import {
  canManageChannels,
  heldRoleIds,
  type MemberView,
  memberDisplayName,
  memberViewToEntry,
  planChannelEdit,
  type RoleView,
  resolveViewerPermissions,
  roleColorFor,
  roleRef,
} from "../src/lib/permissions";

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

function member(partial: Partial<MemberView> & { userId: string }): MemberView {
  return {
    id: partial.userId,
    nickname: null,
    roleIds: [],
    joinedAt: 0,
    timeoutUntil: null,
    ...partial,
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
  permissions: Permission.Kick | Permission.ManageChannels,
});
const admin = role({
  name: "Admin",
  position: 9,
  color: "#8FD19E",
  permissions: Permission.Administrator,
});
const chatty = role({
  name: "Chatty",
  position: 2,
  color: null,
  permissions: Permission.SendMessages,
});
const roles = [admin, moderator, chatty, everyone];

describe("resolveViewerPermissions", () => {
  it("resolves owners to every flag", () => {
    const bits = resolveViewerPermissions({
      viewer: { userId: "owner", isOwner: true },
      member: null,
      roles,
    });
    expect(bits).toBe(ALL_PERMISSIONS);
  });

  it("ORs held roles and honors channel overrides", () => {
    const bits = resolveViewerPermissions({
      viewer: { userId: "u1", isOwner: false },
      member: member({ userId: "u1", roleIds: [EVERYONE_ROLE_ID, "Moderator"] }),
      roles,
    });
    expect((bits & Permission.ManageChannels) !== 0n).toBe(true);

    const denied = resolveViewerPermissions({
      viewer: { userId: "u1", isOwner: false },
      member: member({ userId: "u1", roleIds: [EVERYONE_ROLE_ID, "Moderator"] }),
      roles,
      channelOverrides: [
        {
          targetId: "Moderator",
          targetType: "role",
          allow: 0n,
          deny: Permission.ManageChannels,
        },
      ],
    });
    expect((denied & Permission.ManageChannels) !== 0n).toBe(false);
  });

  it("always includes @everyone in a member's held roles", () => {
    expect(heldRoleIds(member({ userId: "u1" }), roles)).toContain(EVERYONE_ROLE_ID);
  });
});

describe("canManageChannels", () => {
  it("is true for the owner regardless of bits", () => {
    expect(canManageChannels(true, 0n)).toBe(true);
  });

  it("follows the ManageChannels bit for non-owners", () => {
    const manager = resolveViewerPermissions({
      viewer: { userId: "u1", isOwner: false },
      member: member({ userId: "u1", roleIds: [EVERYONE_ROLE_ID, "Moderator"] }),
      roles,
    });
    expect(canManageChannels(false, manager)).toBe(true);

    const chatter = resolveViewerPermissions({
      viewer: { userId: "u2", isOwner: false },
      member: member({ userId: "u2", roleIds: [EVERYONE_ROLE_ID, "Chatty"] }),
      roles,
    });
    expect(canManageChannels(false, chatter)).toBe(false);
  });
});

describe("member view helpers", () => {
  it("prefers nickname, then account name, then fallback", () => {
    expect(memberDisplayName(member({ userId: "u1", nickname: "Ace" }), "Fallback")).toBe("Ace");
    expect(memberDisplayName(member({ userId: "u1", accountName: "Ada" }), "Fallback")).toBe("Ada");
    expect(memberDisplayName(member({ userId: "u1" }), "Fallback")).toBe("Fallback");
    expect(memberDisplayName(null, "Fallback")).toBe("Fallback");
  });

  it("takes the highest-position colored role for the ring", () => {
    const held = member({ userId: "u1", roleIds: [EVERYONE_ROLE_ID, "Moderator", "Admin"] });
    expect(roleColorFor(held, roles)).toBe("#8FD19E");
    expect(
      roleColorFor(member({ userId: "u2", roleIds: [EVERYONE_ROLE_ID, "Chatty"] }), roles),
    ).toBeNull();
  });

  it("flattens a member into a picker entry", () => {
    const entry = memberViewToEntry(
      member({ userId: "u1", accountName: "Ada", roleIds: [EVERYONE_ROLE_ID, "Moderator"] }),
      roles,
      "owner",
      "Member",
    );
    expect(entry).toEqual({
      userId: "u1",
      displayName: "Ada",
      roleIds: [EVERYONE_ROLE_ID, "Moderator"],
      isOwner: false,
      roleColor: "#F5A45B",
    });
    expect(roleRef(moderator)).toBe("Moderator");
  });
});

describe("planChannelEdit", () => {
  const original = {
    name: "general",
    topic: "hello",
    private: false,
    memberIds: [] as readonly string[],
    blockedUserIds: [] as readonly string[],
  };

  it("returns a no-op plan when nothing changed", () => {
    expect(planChannelEdit(original, { ...original }, "me")).toEqual({
      name: null,
      topic: null,
      privacy: null,
      blockedUserIds: null,
    });
  });

  it("applies a trimmed rename and ignores an empty name", () => {
    expect(planChannelEdit(original, { ...original, name: "  launch  " }, "me").name).toBe(
      "launch",
    );
    expect(planChannelEdit(original, { ...original, name: "   " }, "me").name).toBeNull();
  });

  it("applies a topic change only when it differs", () => {
    expect(planChannelEdit(original, { ...original, topic: "new" }, "me").topic).toBe("new");
    expect(planChannelEdit(original, { ...original, topic: "hello" }, "me").topic).toBeNull();
  });

  it("rewrites membership when switching public -> private", () => {
    const plan = planChannelEdit(original, { ...original, private: true, memberIds: ["b"] }, "me");
    expect(plan.privacy).toEqual({ private: true, memberIds: ["me", "b"] });
  });

  it("rewrites membership when the private member set changes", () => {
    const priv = { ...original, private: true, memberIds: ["me", "b"] };
    expect(planChannelEdit(priv, { ...priv, memberIds: ["me"] }, "me").privacy).toEqual({
      private: true,
      memberIds: ["me"],
    });
    expect(planChannelEdit(priv, { ...priv, memberIds: ["b", "me"] }, "me").privacy).toBeNull();
  });

  it("clears membership when switching private -> public", () => {
    const priv = { ...original, private: true, memberIds: ["me", "b"] };
    expect(planChannelEdit(priv, { ...priv, private: false }, "me").privacy).toEqual({
      private: false,
      memberIds: [],
    });
  });

  it("compares blocked users order-insensitively", () => {
    const base = { ...original, blockedUserIds: ["a", "b"] };
    expect(
      planChannelEdit(base, { ...base, blockedUserIds: ["b", "a"] }, "me").blockedUserIds,
    ).toBeNull();
    expect(planChannelEdit(base, { ...base, blockedUserIds: ["b"] }, "me").blockedUserIds).toEqual([
      "b",
    ]);
  });
});
