import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
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

  it("supports a temporary ban whose expiry restores access", async () => {
    const { t, asOwner } = await moderationSetup();
    await asOwner.mutation(api.members.ban, {
      userId: "user-1",
      reason: "cooldown",
      durationMs: 60_000,
    });
    expect(await memberRoleIds(t, "user-1")).toBeNull();

    const bans = await asOwner.query(api.members.listBans, {});
    const ban = bans.find((entry) => entry.userId === "user-1");
    expect(ban?.expiresAt).toBeGreaterThan(Date.now());

    const invite = await asOwner.mutation(api.invites.create, {});
    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.invites.redeem, { code: invite.code }),
    ).rejects.toThrow("banned");

    await t.run(async (ctx) => {
      const row = await ctx.db.query("bans").first();
      if (row !== null) {
        await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
      }
    });

    const result = await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.invites.redeem, { code: invite.code });
    expect(result).toEqual({ joined: true, alreadyMember: false });
    expect(await asOwner.query(api.members.listBans, {})).toHaveLength(0);
  });

  it("never re-attaches roles for a banned user, but allows an expired ban", async () => {
    const { t } = await moderationSetup();
    await t.run(async (ctx) => {
      await ctx.db.insert("bans", {
        userId: "banned",
        actorId: "owner-1",
        at: Date.now(),
        expiresAt: Date.now() + 60_000,
      });
      await ctx.db.insert("bans", {
        userId: "lapsed",
        actorId: "owner-1",
        at: Date.now() - 1_000,
        expiresAt: Date.now() - 1,
      });
    });

    await t.mutation(internal.members.attachRolesFromAuth, { userId: "banned" });
    expect(await memberRoleIds(t, "banned")).toBeNull();

    await t.mutation(internal.members.attachRolesFromAuth, { userId: "lapsed" });
    expect(await memberRoleIds(t, "lapsed")).toEqual([EVERYONE_ROLE_ID]);
    const bans = await t.run(async (ctx) => await ctx.db.query("bans").collect());
    expect(bans.map((ban) => ban.userId)).toEqual(["banned"]);
  });

  it("rejects a non-positive ban duration", async () => {
    const { asOwner } = await moderationSetup();
    await expect(
      asOwner.mutation(api.members.ban, { userId: "user-1", durationMs: -1 }),
    ).rejects.toThrow("positive");
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
