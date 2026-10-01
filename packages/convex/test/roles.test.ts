import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { Test } from "./helpers";
import { newTest, seedWorkspace } from "./helpers";

const MANAGER_PERMISSIONS = Permission.ViewChannel | Permission.ManageRoles | Permission.Kick;

interface RoleRow {
  readonly _id: Id<"roles">;
  readonly key?: string;
  readonly name: string;
  readonly position: number;
  readonly permissions: bigint;
}

async function roles(t: Test): Promise<RoleRow[]> {
  return await t.run(async (ctx) => await ctx.db.query("roles").collect());
}

async function roleByKey(t: Test, key: string): Promise<RoleRow> {
  const all = await roles(t);
  const role = all.find((entry) => entry.key === key);
  if (role === undefined) {
    throw new Error(`role ${key} not found`);
  }
  return role;
}

async function managerSetup() {
  const t = newTest();
  await seedWorkspace(t, {
    extraRoles: [{ key: "manager", permissions: MANAGER_PERMISSIONS, position: 5 }],
    members: [
      { userId: "manager-1", roleIds: [EVERYONE_ROLE_ID, "manager"] },
      { userId: "user-1" },
    ],
  });
  return {
    t,
    asOwner: t.withIdentity({ subject: "owner-1" }),
    asManager: t.withIdentity({ subject: "manager-1" }),
  };
}

describe("roles CRUD", () => {
  it("lets the owner create a role and lists it", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const asOwner = t.withIdentity({ subject: "owner-1" });
    const roleId = await asOwner.mutation(api.roles.create, {
      name: "Moderator",
      color: "#F5A45B",
      permissions: Permission.Kick | Permission.ManageMessages,
      hoisted: true,
      mentionable: true,
      position: 3,
    });

    const list = await asOwner.query(api.roles.list, {});
    const created = list.find((role) => role.id === roleId);
    expect(created).toBeDefined();
    expect(created?.name).toBe("Moderator");
    expect(created?.position).toBe(3);
    expect(created?.hoisted).toBe(true);
    expect(created?.mentionable).toBe(true);
  });

  it("refuses to delete or move @everyone", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const asOwner = t.withIdentity({ subject: "owner-1" });
    const everyone = await roleByKey(t, EVERYONE_ROLE_ID);

    await expect(asOwner.mutation(api.roles.remove, { roleId: everyone._id })).rejects.toThrow(
      "@everyone",
    );
    await expect(
      asOwner.mutation(api.roles.reorder, {
        positions: [{ roleId: everyone._id, position: 1 }],
      }),
    ).rejects.toThrow("@everyone");
  });

  it("reorders roles by position", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const asOwner = t.withIdentity({ subject: "owner-1" });
    const first = await asOwner.mutation(api.roles.create, { name: "A", position: 1 });
    const second = await asOwner.mutation(api.roles.create, { name: "B", position: 2 });

    await asOwner.mutation(api.roles.reorder, {
      positions: [
        { roleId: first, position: 2 },
        { roleId: second, position: 1 },
      ],
    });

    const all = await roles(t);
    expect(all.find((role) => role._id === first)?.position).toBe(2);
    expect(all.find((role) => role._id === second)?.position).toBe(1);
  });

  it("refuses a permission the actor does not hold", async () => {
    const { asManager } = await managerSetup();
    await expect(
      asManager.mutation(api.roles.create, { name: "Banned", permissions: Permission.Ban }),
    ).rejects.toThrow("Cannot grant");
  });

  it("only manages roles strictly below the actor's top role", async () => {
    const { t, asOwner, asManager } = await managerSetup();
    const high = await asOwner.mutation(api.roles.create, { name: "High", position: 10 });

    await expect(
      asManager.mutation(api.roles.update, { roleId: high, name: "Renamed" }),
    ).rejects.toThrow("not below");
    await expect(
      asManager.mutation(api.roles.reorder, {
        positions: [{ roleId: high, position: 1 }],
      }),
    ).rejects.toThrow("not below");
    expect((await roles(t)).find((role) => role._id === high)?.name).toBe("High");
  });

  it("forbids a non-owner from changing @everyone permissions but allows the owner", async () => {
    const { t, asOwner, asManager } = await managerSetup();
    const everyone = await roleByKey(t, EVERYONE_ROLE_ID);

    await expect(
      asManager.mutation(api.roles.update, { roleId: everyone._id, permissions: 0n }),
    ).rejects.toThrow("Only the owner");

    await asOwner.mutation(api.roles.update, {
      roleId: everyone._id,
      permissions: Permission.Kick,
    });
    expect((await roleByKey(t, EVERYONE_ROLE_ID)).permissions).toBe(Permission.Kick);
  });

  it("deletes a manageable role and detaches it from members", async () => {
    const { t, asOwner } = await managerSetup();
    const roleId = await asOwner.mutation(api.roles.create, { name: "Temp", position: 1 });
    await asOwner.mutation(api.members.assignRole, { userId: "user-1", roleId });
    await asOwner.mutation(api.roles.remove, { roleId });

    const member = await t.run(async (ctx) => {
      const all = await ctx.db.query("members").collect();
      return all.find((entry) => entry.userId === "user-1") ?? null;
    });
    expect(member?.roleIds).not.toContain(roleId);
  });
});
