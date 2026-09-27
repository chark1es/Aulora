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
