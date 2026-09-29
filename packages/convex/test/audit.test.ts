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
    const channelId = await asOwner.mutation(api.channels.create, {
      kind: "text",
      name: "general",
    });
    await asOwner.mutation(api.channels.rename, { channelId, name: "eA==" });
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

  it("enriches actor/target names, audits moderation and omits routine events", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "owner-1" }, { userId: "user-1" }, { userId: "user-2" }],
    });
    const asOwner = t.withIdentity({ subject: "owner-1" });
    const asUser = t.withIdentity({ subject: "user-1" });

    await asOwner.mutation(api.members.setNickname, { userId: "owner-1", nickname: "Alice" });
    await asOwner.mutation(api.members.setNickname, { userId: "user-2", nickname: "Bob" });
    const channelId = await asOwner.mutation(api.channels.create, {
      kind: "text",
      name: "general",
    });
    await asUser.mutation(api.channels.join, { channelId });
    await asUser.mutation(api.channels.leave, { channelId });
    await asUser.mutation(api.channels.createDm, { otherUserId: "user-2" });
    const messageId = await asUser.mutation(api.messages.send, {
      channelId,
      body: "aGk=",
    });
    await asOwner.mutation(api.messages.pin, { messageId });
    await asOwner.mutation(api.messages.unpin, { messageId });
    // A moderator deleting another member's message is a moderation act and is
    // audited; a self-delete is not (covered in messages.test.ts).
    await asOwner.mutation(api.messages.remove, { messageId });

    const log = await asOwner.query(api.auditLog.list, { paginationOpts: PAGE });
    const actions = log.page.map((row) => row.action);
    expect(actions).toContain("channel.create");
    expect(actions).toContain("member.nickname");
    expect(actions).toContain("message.delete");
    for (const noisy of [
      "channel.join",
      "channel.leave",
      "channel.createDm",
      "channel.createGroupDm",
      "message.pin",
      "message.unpin",
    ]) {
      expect(actions).not.toContain(noisy);
    }

    const nicknameRow = log.page.find(
      (row) => row.action === "member.nickname" && row.targetId === "user-2",
    );
    expect(nicknameRow?.actorName).toBe("Alice");
    expect(nicknameRow?.targetName).toBe("Bob");
    expect(log.page.find((row) => row.action === "channel.create")?.actorName).toBe("Alice");
    expect(log.page.find((row) => row.action === "message.delete")?.actorId).toBe("owner-1");
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
