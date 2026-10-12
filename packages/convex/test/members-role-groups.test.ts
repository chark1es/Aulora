import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, seedWorkspace } from "./helpers";

/**
 * The member list groups by hoisted role on both clients, which needs the
 * server to expose the role refs a member holds (`members.list`) and the hoist
 * metadata for every role (`roles.list`). These pin that contract.
 */
describe("member role grouping contract", () => {
  it("exposes the role refs and hoist metadata clients group by", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      extraRoles: [{ key: "mod", permissions: Permission.Kick, position: 4 }],
      members: [{ userId: "ada", roleIds: [EVERYONE_ROLE_ID, "mod"] }],
    });
    const asOwner = t.withIdentity({ subject: "owner-1" });

    const roleId = await asOwner.mutation(api.roles.create, {
      name: "Moderators",
      color: "#f2545b",
      hoisted: true,
      position: 5,
    });
    await asOwner.mutation(api.members.assignRole, { userId: "ada", roleId });

    const roles = await asOwner.query(api.roles.list, {});
    expect(roles.find((role) => role.id === roleId)).toMatchObject({
      name: "Moderators",
      color: "#f2545b",
      position: 5,
      hoisted: true,
      isEveryone: false,
    });

    const members = await asOwner.query(api.members.list, {});
    expect(members.find((member) => member.userId === "ada")?.roleIds).toContain(roleId);
  });
});
