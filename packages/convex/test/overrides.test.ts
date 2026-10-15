import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

const PAGE = { numItems: 50, cursor: null } as const;

async function seedCategory(
  t: ReturnType<typeof newTest>,
  overrides: {
    targetId: string;
    targetType: "role" | "member";
    allow: bigint;
    deny: bigint;
  }[],
): Promise<Id<"categories">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("categories", { name: "General", position: 0, overrides });
  });
}

describe("permission overrides", () => {
  it("hides a category channel when the category denies ViewChannel", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.ReadHistory,
      members: [{ userId: "user-1" }],
    });
    const categoryId = await seedCategory(t, [
      { targetId: EVERYONE_ROLE_ID, targetType: "role", allow: 0n, deny: Permission.ViewChannel },
    ]);
    const channelId = await seedChannel(t, { categoryId });
    const visibleId = await seedChannel(t, {});

    const asUser = t.withIdentity({ subject: "user-1" });
    const result = await asUser.query(api.channels.list, { paginationOpts: PAGE });
    const ids = result.page.map((channel) => channel.id);
    expect(ids).toContain(visibleId);
    expect(ids).not.toContain(channelId);
    await expect(asUser.query(api.channels.get, { channelId })).rejects.toThrow(
      "Missing permission",
    );
  });

  it("lets a channel allow override a category deny", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.ReadHistory,
      members: [{ userId: "user-1" }],
    });
    const categoryId = await seedCategory(t, [
      { targetId: EVERYONE_ROLE_ID, targetType: "role", allow: 0n, deny: Permission.ViewChannel },
    ]);
    const channelId = await seedChannel(t, {
      categoryId,
      overrides: [
        { targetId: EVERYONE_ROLE_ID, targetType: "role", allow: Permission.ViewChannel, deny: 0n },
      ],
    });

    const asUser = t.withIdentity({ subject: "user-1" });
    const result = await asUser.query(api.channels.list, { paginationOpts: PAGE });
    expect(result.page.map((channel) => channel.id)).toContain(channelId);
  });

  it("applies a member-specific channel deny to one member only", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.ReadHistory,
      members: [{ userId: "user-1" }, { userId: "user-2" }],
    });
    const channelId = await seedChannel(t, {
      overrides: [
        { targetId: "user-1", targetType: "member", allow: 0n, deny: Permission.ViewChannel },
      ],
    });

    const forOne = await t
      .withIdentity({ subject: "user-1" })
      .query(api.channels.list, { paginationOpts: PAGE });
    const forTwo = await t
      .withIdentity({ subject: "user-2" })
      .query(api.channels.list, { paginationOpts: PAGE });
    expect(forOne.page.map((channel) => channel.id)).not.toContain(channelId);
    expect(forTwo.page.map((channel) => channel.id)).toContain(channelId);
  });

  it("hides the channel when a channel override removes ViewChannel", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.ReadHistory,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t, {});
    const asOwner = t.withIdentity({ subject: "owner-1" });

    const signal = await asOwner.mutation(api.channels.setOverrides, {
      channelId,
      overrides: [
        { targetId: EVERYONE_ROLE_ID, targetType: "role", allow: 0n, deny: Permission.ViewChannel },
      ],
    });
    expect(signal).toBeNull();
  });

  it("clears a channel override", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.ReadHistory,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t, {
      overrides: [
        { targetId: EVERYONE_ROLE_ID, targetType: "role", allow: 0n, deny: Permission.ViewChannel },
      ],
    });
    const asOwner = t.withIdentity({ subject: "owner-1" });
    await asOwner.mutation(api.channels.clearOverride, {
      channelId,
      targetId: EVERYONE_ROLE_ID,
      targetType: "role",
    });

    const result = await t
      .withIdentity({ subject: "user-1" })
      .query(api.channels.list, { paginationOpts: PAGE });
    expect(result.page.map((channel) => channel.id)).toContain(channelId);
  });

  it("rejects an override that both allows and denies a flag, and enforces ManageChannels", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.ReadHistory,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t, {});
    const asOwner = t.withIdentity({ subject: "owner-1" });

    await expect(
      asOwner.mutation(api.channels.setOverrides, {
        channelId,
        overrides: [
          {
            targetId: EVERYONE_ROLE_ID,
            targetType: "role",
            allow: Permission.ViewChannel,
            deny: Permission.ViewChannel,
          },
        ],
      }),
    ).rejects.toThrow("allow and deny");

    const asUser = t.withIdentity({ subject: "user-1" });
    await expect(
      asUser.mutation(api.channels.setOverrides, { channelId, overrides: [] }),
    ).rejects.toThrow("Missing permission");
  });
});

describe("channel role override authorization", () => {
  async function seedModerator() {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel,
      extraRoles: [
        { key: "mod", permissions: Permission.ManageChannels, position: 5 },
        { key: "junior", permissions: Permission.ViewChannel, position: 2 },
        { key: "high", permissions: 0n, position: 9 },
      ],
      members: [{ userId: "user-1", roleIds: ["mod"] }],
    });
    const channelId = await seedChannel(t, {});
    return { t, channelId };
  }

  it("lets a moderator set allowed bits on a role below them", async () => {
    const { t, channelId } = await seedModerator();
    const asMod = t.withIdentity({ subject: "user-1" });

    await asMod.mutation(api.channels.setOverrides, {
      channelId,
      overrides: [
        { targetId: "junior", targetType: "role", allow: Permission.ViewChannel, deny: 0n },
      ],
    });

    const channel = await t.run(async (ctx) => await ctx.db.get(channelId));
    expect(channel?.overrides).toEqual([
      { targetId: "junior", targetType: "role", allow: Permission.ViewChannel, deny: 0n },
    ]);
  });

  it("rejects granting a permission the moderator does not hold", async () => {
    const { t, channelId } = await seedModerator();
    const asMod = t.withIdentity({ subject: "user-1" });

    await expect(
      asMod.mutation(api.channels.setOverrides, {
        channelId,
        overrides: [
          { targetId: "junior", targetType: "role", allow: Permission.SendMessages, deny: 0n },
        ],
      }),
    ).rejects.toThrow("Cannot grant a permission you do not hold");
  });

  it("rejects editing a role at or above the moderator's highest role", async () => {
    const { t, channelId } = await seedModerator();
    const asMod = t.withIdentity({ subject: "user-1" });

    await expect(
      asMod.mutation(api.channels.setOverrides, {
        channelId,
        overrides: [
          { targetId: "high", targetType: "role", allow: 0n, deny: Permission.ViewChannel },
        ],
      }),
    ).rejects.toThrow("Role is not below your highest role");
  });

  async function seedHighOverride() {
    const { t } = await seedModerator();
    const channelId = await seedChannel(t, {
      overrides: [
        { targetId: "high", targetType: "role", allow: 0n, deny: Permission.ViewChannel },
        { targetId: "junior", targetType: "role", allow: Permission.ViewChannel, deny: 0n },
      ],
    });
    return { t, channelId, asMod: t.withIdentity({ subject: "user-1" }) };
  }

  it("rejects clearing an override on a role above the moderator", async () => {
    const { channelId, asMod } = await seedHighOverride();

    await expect(
      asMod.mutation(api.channels.clearOverride, {
        channelId,
        targetId: "high",
        targetType: "role",
      }),
    ).rejects.toThrow("Role is not below your highest role");
  });

  it("rejects dropping a higher role's override by omitting it from setOverrides", async () => {
    const { channelId, asMod } = await seedHighOverride();

    await expect(
      asMod.mutation(api.channels.setOverrides, {
        channelId,
        overrides: [
          { targetId: "junior", targetType: "role", allow: Permission.ViewChannel, deny: 0n },
        ],
      }),
    ).rejects.toThrow("Role is not below your highest role");
  });

  it("rejects changing a higher role's override", async () => {
    const { channelId, asMod } = await seedHighOverride();

    await expect(
      asMod.mutation(api.channels.setOverrides, {
        channelId,
        overrides: [
          { targetId: "high", targetType: "role", allow: 0n, deny: 0n },
          { targetId: "junior", targetType: "role", allow: Permission.ViewChannel, deny: 0n },
        ],
      }),
    ).rejects.toThrow("Role is not below your highest role");
  });

  it("accepts a higher role's override resubmitted unchanged", async () => {
    const { t, channelId, asMod } = await seedHighOverride();

    await asMod.mutation(api.channels.setOverrides, {
      channelId,
      overrides: [
        { targetId: "high", targetType: "role", allow: 0n, deny: Permission.ViewChannel },
        { targetId: "junior", targetType: "role", allow: 0n, deny: Permission.ViewChannel },
      ],
    });

    const channel = await t.run(async (ctx) => await ctx.db.get(channelId));
    expect(channel?.overrides).toHaveLength(2);
  });

  it("still lets a moderator set member-target overrides", async () => {
    const { t, channelId } = await seedModerator();
    const asMod = t.withIdentity({ subject: "user-1" });

    await asMod.mutation(api.channels.setOverrides, {
      channelId,
      overrides: [
        { targetId: "user-2", targetType: "member", allow: 0n, deny: Permission.ViewChannel },
      ],
    });

    const channel = await t.run(async (ctx) => await ctx.db.get(channelId));
    expect(channel?.overrides).toEqual([
      { targetId: "user-2", targetType: "member", allow: 0n, deny: Permission.ViewChannel },
    ]);
  });

  it("rejects granting a member a permission the moderator does not hold", async () => {
    const { t, channelId } = await seedModerator();
    const asMod = t.withIdentity({ subject: "user-1" });

    await expect(
      asMod.mutation(api.channels.setOverrides, {
        channelId,
        overrides: [
          { targetId: "user-2", targetType: "member", allow: Permission.SendMessages, deny: 0n },
        ],
      }),
    ).rejects.toThrow("Cannot grant a permission you do not hold");
  });

  it("allows resubmitting a pre-existing grant the moderator does not hold", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel,
      extraRoles: [
        { key: "mod", permissions: Permission.ManageChannels, position: 5 },
        { key: "junior", permissions: Permission.ViewChannel, position: 2 },
      ],
      members: [{ userId: "user-1", roleIds: ["mod"] }],
    });
    const channelId = await seedChannel(t, {
      overrides: [
        { targetId: "junior", targetType: "role", allow: Permission.SendMessages, deny: 0n },
      ],
    });
    const asMod = t.withIdentity({ subject: "user-1" });

    // The pre-existing SendMessages grant is untouched; only the newly added,
    // held ViewChannel bit is what the actor is granting here.
    await asMod.mutation(api.channels.setOverrides, {
      channelId,
      overrides: [
        {
          targetId: "junior",
          targetType: "role",
          allow: Permission.SendMessages | Permission.ViewChannel,
          deny: 0n,
        },
      ],
    });

    const channel = await t.run(async (ctx) => await ctx.db.get(channelId));
    expect(channel?.overrides).toEqual([
      {
        targetId: "junior",
        targetType: "role",
        allow: Permission.SendMessages | Permission.ViewChannel,
        deny: 0n,
      },
    ]);
  });

  it("rejects an override aimed at a role that does not exist", async () => {
    const { t, channelId } = await seedModerator();
    const asMod = t.withIdentity({ subject: "user-1" });

    await expect(
      asMod.mutation(api.channels.setOverrides, {
        channelId,
        overrides: [
          { targetId: "ghost", targetType: "role", allow: Permission.ViewChannel, deny: 0n },
        ],
      }),
    ).rejects.toThrow("Role not found");
  });
});
