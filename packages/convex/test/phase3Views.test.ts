import { Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

/**
 * Phase 3 view additions consumed by the admin UI: the caller's own membership,
 * the full workspace settings and channel overrides on the channel summary.
 */
describe("phase 3 admin views", () => {
  it("reports the caller's membership and owner status", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asOwner = t.withIdentity({ subject: "owner-1" });
    const asMember = t.withIdentity({ subject: "user-1" });

    const owner = await asOwner.query(api.members.me, {});
    expect(owner.isOwner).toBe(true);
    expect(owner.ownerId).toBe("owner-1");

    const member = await asMember.query(api.members.me, {});
    expect(member.isOwner).toBe(false);
    expect(member.member?.userId).toBe("user-1");
  });

  it("returns settings only to an actor that can manage the workspace", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      extraRoles: [{ key: "mod", permissions: Permission.ManageRoles, position: 2 }],
      members: [{ userId: "mod-1", roleIds: ["@everyone", "mod"] }],
    });
    const asOwner = t.withIdentity({ subject: "owner-1" });
    const asMod = t.withIdentity({ subject: "mod-1" });

    const settings = await asOwner.query(api.server.settings, {});
    expect(settings.settings.inviteOnly).toBe(true);
    await expect(asMod.query(api.server.settings, {})).rejects.toThrow("Missing permission");
  });

  it("exposes channel overrides on the channel summary", async () => {
    const t = newTest();
    await seedWorkspace(t, { ownerId: "owner-1" });
    const channelId = await seedChannel(t, {
      overrides: [
        { targetId: "Moderator", targetType: "role", allow: Permission.ManageMessages, deny: 0n },
      ],
    });
    const asOwner = t.withIdentity({ subject: "owner-1" });

    const page = await asOwner.query(api.channels.list, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    const summary = page.page.find((channel) => channel.id === channelId);
    expect(summary?.overrides).toHaveLength(1);
    expect(summary?.overrides[0]?.targetId).toBe("Moderator");

    const one = await asOwner.query(api.channels.get, { channelId });
    expect(one.overrides).toHaveLength(1);
  });
});
