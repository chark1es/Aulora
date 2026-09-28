import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { newTest, seedChannel, seedWorkspace, type Test } from "./helpers";

function memberIdsOf(t: Test, channelId: Id<"channels">): Promise<string[]> {
  return t.run(async (ctx) => {
    const rows = await ctx.db
      .query("channelMembers")
      .filter((q) => q.eq(q.field("channelId"), channelId))
      .collect();
    return rows.map((row) => row.userId).sort();
  });
}

describe("channels.setPrivate", () => {
  it("makes a channel private and resets membership to the actor plus members", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.ReadHistory,
      members: [{ userId: "user-1" }, { userId: "user-2" }, { userId: "user-3" }],
    });
    const channelId = await seedChannel(t, { memberIds: ["user-1", "user-9"] });
    const asOwner = t.withIdentity({ subject: "owner-1" });

    await asOwner.mutation(api.channels.setPrivate, {
      channelId,
      private: true,
      memberIds: ["user-2", "user-3", "user-2"],
    });

    const channel = await t.run(async (ctx) => await ctx.db.get(channelId));
    expect(channel?.private).toBe(true);
    expect(await memberIdsOf(t, channelId)).toEqual(["owner-1", "user-2", "user-3"]);
  });

  it("returns a channel to public and clears its member rows", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.ReadHistory,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t, { private: true, memberIds: ["user-1"] });
    const asOwner = t.withIdentity({ subject: "owner-1" });

    await asOwner.mutation(api.channels.setPrivate, { channelId, private: false });

    const channel = await t.run(async (ctx) => await ctx.db.get(channelId));
    expect(channel?.private).toBeUndefined();
    expect(await memberIdsOf(t, channelId)).toEqual([]);
  });

  it("rejects changing the privacy of a DM", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const dmId = await seedChannel(t, { kind: "dm", memberIds: ["owner-1", "user-1"] });
    const asOwner = t.withIdentity({ subject: "owner-1" });
    await expect(
      asOwner.mutation(api.channels.setPrivate, { channelId: dmId, private: true }),
    ).rejects.toThrow("DM");
  });
});

describe("channels.setBlockedUsers", () => {
  it("adds a member deny ViewChannel override and preserves unrelated flags", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.ReadHistory,
      members: [{ userId: "user-1" }, { userId: "user-2" }],
    });
    const channelId = await seedChannel(t, {
      private: true,
      memberIds: ["user-1", "user-2"],
      overrides: [
        {
          targetId: EVERYONE_ROLE_ID,
          targetType: "role",
          allow: Permission.SendMessages,
          deny: 0n,
        },
        { targetId: "user-2", targetType: "member", allow: Permission.SendMessages, deny: 0n },
      ],
    });
    const asOwner = t.withIdentity({ subject: "owner-1" });

    await asOwner.mutation(api.channels.setBlockedUsers, {
      channelId,
      userIds: ["user-1", "user-1"],
    });

    const channel = await t.run(async (ctx) => await ctx.db.get(channelId));
    const overrides: {
      targetId: string;
      targetType: "role" | "member";
      allow: bigint;
      deny: bigint;
    }[] = channel?.overrides ?? [];
    const role = overrides.find((override) => override.targetType === "role");
    expect(role).toMatchObject({
      targetId: EVERYONE_ROLE_ID,
      allow: Permission.SendMessages,
      deny: 0n,
    });
    const other = overrides.find(
      (override) => override.targetType === "member" && override.targetId === "user-2",
    );
    expect(other?.allow).toBe(Permission.SendMessages);
    expect(other?.deny).toBe(0n);
    const blocked = overrides.find(
      (override) => override.targetType === "member" && override.targetId === "user-1",
    );
    expect((blocked?.deny ?? 0n) & Permission.ViewChannel).toBe(Permission.ViewChannel);
    expect(blocked?.allow).toBe(0n);
    expect(await memberIdsOf(t, channelId)).toEqual(["user-2"]);
  });

  it("replaces a previously blocked member when passed an empty list", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.ReadHistory,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t, {
      overrides: [
        { targetId: "user-1", targetType: "member", allow: 0n, deny: Permission.ViewChannel },
      ],
    });
    const asOwner = t.withIdentity({ subject: "owner-1" });

    await asOwner.mutation(api.channels.setBlockedUsers, { channelId, userIds: [] });

    const channel = await t.run(async (ctx) => await ctx.db.get(channelId));
    expect(channel?.overrides).toEqual([]);
  });

  it("preserves another member's explicit ViewChannel grant while blocking a different member", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.ReadHistory,
      members: [{ userId: "user-1" }, { userId: "user-2" }, { userId: "user-3" }],
    });
    const channelId = await seedChannel(t, {
      private: true,
      memberIds: ["user-2", "user-3"],
      overrides: [
        {
          targetId: "user-2",
          targetType: "member",
          allow: Permission.ViewChannel | Permission.SendMessages,
          deny: 0n,
        },
      ],
    });
    const asOwner = t.withIdentity({ subject: "owner-1" });

    await asOwner.mutation(api.channels.setBlockedUsers, { channelId, userIds: ["user-3"] });

    const channel = await t.run(async (ctx) => await ctx.db.get(channelId));
    const overrides: {
      targetId: string;
      targetType: "role" | "member";
      allow: bigint;
      deny: bigint;
    }[] = channel?.overrides ?? [];
    const preserved = overrides.find(
      (override) => override.targetType === "member" && override.targetId === "user-2",
    );
    expect(preserved?.allow).toBe(Permission.ViewChannel | Permission.SendMessages);
    expect(preserved?.deny).toBe(0n);
    const blocked = overrides.find(
      (override) => override.targetType === "member" && override.targetId === "user-3",
    );
    expect(blocked?.allow).toBe(0n);
    expect((blocked?.deny ?? 0n) & Permission.ViewChannel).toBe(Permission.ViewChannel);
    expect(await memberIdsOf(t, channelId)).toEqual(["user-2"]);
  });

  it("restores membership when unblocking a member on a private channel", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.ReadHistory,
      members: [{ userId: "user-1" }, { userId: "user-2" }],
    });
    const channelId = await seedChannel(t, {
      private: true,
      memberIds: ["user-2"],
      overrides: [
        { targetId: "user-1", targetType: "member", allow: 0n, deny: Permission.ViewChannel },
      ],
    });
    const asOwner = t.withIdentity({ subject: "owner-1" });

    await asOwner.mutation(api.channels.setBlockedUsers, { channelId, userIds: [] });

    expect(await memberIdsOf(t, channelId)).toEqual(["user-1", "user-2"]);
    const channel = await t.run(async (ctx) => await ctx.db.get(channelId));
    expect(channel?.overrides).toEqual([]);
  });

  it("preserves a non-ViewChannel allow on an unblocked member", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.ReadHistory,
      members: [{ userId: "user-1" }, { userId: "user-2" }],
    });
    const channelId = await seedChannel(t, {
      overrides: [
        {
          targetId: "user-1",
          targetType: "member",
          allow: Permission.SendMessages,
          deny: Permission.AddReactions,
        },
      ],
    });
    const asOwner = t.withIdentity({ subject: "owner-1" });

    await asOwner.mutation(api.channels.setBlockedUsers, { channelId, userIds: ["user-2"] });

    const channel = await t.run(async (ctx) => await ctx.db.get(channelId));
    const kept: {
      targetId: string;
      targetType: "role" | "member";
      allow: bigint;
      deny: bigint;
    }[] = channel?.overrides ?? [];
    const preserved = kept.find(
      (override) => override.targetType === "member" && override.targetId === "user-1",
    );
    expect(preserved).toMatchObject({
      targetId: "user-1",
      targetType: "member",
      allow: Permission.SendMessages,
      deny: Permission.AddReactions,
    });
  });

  it("requires ManageChannels", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.ReadHistory,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t, {});
    const asUser = t.withIdentity({ subject: "user-1" });

    await expect(
      asUser.mutation(api.channels.setBlockedUsers, { channelId, userIds: ["user-1"] }),
    ).rejects.toThrow("Missing permission");
    await expect(
      asUser.mutation(api.channels.setPrivate, { channelId, private: true }),
    ).rejects.toThrow("Missing permission");
  });
});
