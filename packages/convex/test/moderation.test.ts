import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, seedWorkspace, type Test } from "./helpers";

const MANAGER_PERMISSIONS =
  Permission.ViewChannel | Permission.ManageRoles | Permission.Kick | Permission.ManageNicknames;

async function moderationSetup() {
  const t = newTest();
  await seedWorkspace(t, {
    everyonePermissions: Permission.ViewChannel | Permission.ReadHistory,
    extraRoles: [{ key: "manager", permissions: MANAGER_PERMISSIONS, position: 5 }],
    members: [
      { userId: "manager-1", roleIds: [EVERYONE_ROLE_ID, "manager"] },
      { userId: "manager-2", roleIds: [EVERYONE_ROLE_ID, "manager"] },
      { userId: "user-1" },
    ],
  });
  return {
    t,
    asOwner: t.withIdentity({ subject: "owner-1" }),
    asManager: t.withIdentity({ subject: "manager-1" }),
    asUser: t.withIdentity({ subject: "user-1" }),
  };
}

async function memberRoleIds(t: Test, userId: string) {
  return await t.run(async (ctx) => {
    const all = await ctx.db.query("members").collect();
    const member = all.find((entry) => entry.userId === userId);
    return member?.roleIds ?? null;
  });
}

describe("role assignment", () => {
  it("assigns a role the actor holds to a lower member", async () => {
    const { t, asManager } = await moderationSetup();
    const roleId = await t.withIdentity({ subject: "owner-1" }).mutation(api.roles.create, {
      name: "Helper",
      permissions: Permission.Kick,
      position: 1,
    });

    await asManager.mutation(api.members.assignRole, { userId: "user-1", roleId });
    expect(await memberRoleIds(t, "user-1")).toContain(roleId);
  });

  it("refuses a role that grants a permission the actor lacks", async () => {
    const { t, asManager } = await moderationSetup();
    const roleId = await t.withIdentity({ subject: "owner-1" }).mutation(api.roles.create, {
      name: "Bannable",
      permissions: Permission.Ban,
      position: 1,
    });

    await expect(
      asManager.mutation(api.members.assignRole, { userId: "user-1", roleId }),
    ).rejects.toThrow("Cannot grant");
  });

  it("requires ManageRoles", async () => {
    const { t, asUser } = await moderationSetup();
    const roleId = await t.withIdentity({ subject: "owner-1" }).mutation(api.roles.create, {
      name: "Helper",
      permissions: Permission.Kick,
      position: 1,
    });
    await expect(
      asUser.mutation(api.members.assignRole, { userId: "user-1", roleId }),
    ).rejects.toThrow("Missing permission");
  });
});

describe("moderation", () => {
  it("requires Kick", async () => {
    const { asUser } = await moderationSetup();
    await expect(asUser.mutation(api.members.kick, { userId: "user-1" })).rejects.toThrow(
      "Missing permission",
    );
  });

  it("kicks a lower member but never an equal or higher one", async () => {
    const { t, asManager } = await moderationSetup();
    await expect(asManager.mutation(api.members.kick, { userId: "manager-2" })).rejects.toThrow(
      "not below",
    );

    await asManager.mutation(api.members.kick, { userId: "user-1" });
    expect(await memberRoleIds(t, "user-1")).toBeNull();
  });

  it("requires Ban", async () => {
    const { asManager } = await moderationSetup();
    await expect(asManager.mutation(api.members.ban, { userId: "user-1" })).rejects.toThrow(
      "Missing permission",
    );
  });

  it("bans, lists and unbans", async () => {
    const { t, asOwner } = await moderationSetup();
    await asOwner.mutation(api.members.ban, { userId: "user-1", reason: "spam" });
    expect(await memberRoleIds(t, "user-1")).toBeNull();

    const bans = await asOwner.query(api.members.listBans, {});
    expect(bans.some((ban) => ban.userId === "user-1" && ban.reason === "spam")).toBe(true);

    const result = await asOwner.mutation(api.members.unban, { userId: "user-1" });
    expect(result.unbanned).toBe(true);
    expect(await asOwner.query(api.members.listBans, {})).toHaveLength(0);
  });

  it("requires Timeout and applies it to a lower member", async () => {
    const { t, asManager, asOwner } = await moderationSetup();
    await expect(
      asManager.mutation(api.members.timeout, { userId: "user-1", until: Date.now() + 60_000 }),
    ).rejects.toThrow("Missing permission");

    const until = Date.now() + 60_000;
    await asOwner.mutation(api.members.timeout, { userId: "user-1", until });
    const member = await t.run(async (ctx) => {
      const all = await ctx.db.query("members").collect();
      return all.find((entry) => entry.userId === "user-1") ?? null;
    });
    expect(member?.timeoutUntil).toBe(until);
  });

  it("manages nicknames under the right permission and hierarchy", async () => {
    const { asManager, asUser } = await moderationSetup();
    await expect(
      asUser.mutation(api.members.setNickname, { userId: "user-1", nickname: "me" }),
    ).rejects.toThrow("Missing permission");

    await asManager.mutation(api.members.setNickname, {
      userId: "user-1",
      nickname: "helper",
    });
    await expect(
      asManager.mutation(api.members.setNickname, { userId: "manager-2", nickname: "peer" }),
    ).rejects.toThrow("not below");
  });
});
