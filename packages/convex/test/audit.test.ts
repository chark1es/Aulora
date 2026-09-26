import { Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, seedWorkspace } from "./helpers";

const PAGE = { numItems: 50, cursor: null } as const;

describe("audit log", () => {
  it("records role, member, channel, invite and setting changes", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1" }],
    });
    const asOwner = t.withIdentity({ subject: "owner-1" });

    const roleId = await asOwner.mutation(api.roles.create, {
      name: "Mod",
      permissions: Permission.Kick,
    });
    await asOwner.mutation(api.members.assignRole, { userId: "user-1", roleId });
    const channelId = await asOwner.mutation(api.channels.create, { kind: "text" });
    await asOwner.mutation(api.channels.rename, { channelId, nameCiphertext: "eA==" });
    const invite = await asOwner.mutation(api.invites.create, {});
    await asOwner.mutation(api.invites.revoke, { inviteId: invite.inviteId });
    await asOwner.mutation(api.server.updateSettings, { inviteOnly: false });

    const log = await asOwner.query(api.auditLog.list, { paginationOpts: PAGE });
    const actions = log.page.map((row) => row.action);
    expect(actions).toContain("role.create");
    expect(actions).toContain("member.role.add");
    expect(actions).toContain("channel.create");
    expect(actions).toContain("channel.rename");
    expect(actions).toContain("invite.create");
    expect(actions).toContain("invite.revoke");
    expect(actions).toContain("server.updateSettings");
    for (const row of log.page) {
      expect(row.actorId).toBe("owner-1");
    }
  });

  it("is gated by ViewAuditLog", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asUser = t.withIdentity({ subject: "user-1" });
    await expect(asUser.query(api.auditLog.list, { paginationOpts: PAGE })).rejects.toThrow(
      "Missing permission",
    );
  });

  it("lets a member with ViewAuditLog read it", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.ViewAuditLog,
      members: [{ userId: "user-1" }],
    });
    const asUser = t.withIdentity({ subject: "user-1" });
    const log = await asUser.query(api.auditLog.list, { paginationOpts: PAGE });
    expect(Array.isArray(log.page)).toBe(true);
  });

  it("gates settings changes behind ManageWorkspace", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asUser = t.withIdentity({ subject: "user-1" });
    await expect(asUser.mutation(api.server.updateSettings, { inviteOnly: false })).rejects.toThrow(
      "Missing permission",
    );
  });
});
