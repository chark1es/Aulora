import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import type { Test } from "./helpers";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

const PAGE = { numItems: 50, cursor: null } as const;

async function categories(t: Test) {
  return await t.run(async (ctx) => await ctx.db.query("categories").collect());
}

describe("categories CRUD", () => {
  it("creates, lists, renames and repositions categories", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const asOwner = t.withIdentity({ subject: "owner-1" });

    const first = await asOwner.mutation(api.categories.create, { name: "Text" });
    const second = await asOwner.mutation(api.categories.create, { name: "Voice" });

    let list = await asOwner.query(api.categories.list, {});
    expect(list.map((category) => category.id)).toEqual([first, second]);

    await asOwner.mutation(api.categories.update, {
      categoryId: first,
      name: "General",
      position: 5,
    });
    list = await asOwner.query(api.categories.list, {});
    const renamed = list.find((category) => category.id === first);
    expect(renamed?.name).toBe("General");
    expect(list.map((category) => category.id)).toEqual([second, first]);
  });

  it("deletes a category and leaves its channels uncategorised", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const asOwner = t.withIdentity({ subject: "owner-1" });
    const categoryId = await asOwner.mutation(api.categories.create, { name: "General" });
    const channelId = await seedChannel(t, { categoryId });

    await asOwner.mutation(api.categories.remove, { categoryId });

    expect((await categories(t)).some((category) => category._id === categoryId)).toBe(false);
    const channel = await t.run(async (ctx) => await ctx.db.get(channelId));
    expect(channel?.categoryId).toBeUndefined();
  });

  it("gates create and remove behind ManageChannels", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const categoryId = await t
      .withIdentity({ subject: "owner-1" })
      .mutation(api.categories.create, { name: "General" });
    const asUser = t.withIdentity({ subject: "user-1" });

    await expect(asUser.mutation(api.categories.create, { name: "Nope" })).rejects.toThrow(
      "Missing permission",
    );
    await expect(asUser.mutation(api.categories.remove, { categoryId })).rejects.toThrow(
      "Missing permission",
    );
    await expect(asUser.query(api.categories.list, {})).resolves.toBeDefined();
  });
});

describe("category overrides", () => {
  it("hides the channel when ViewChannel is lost and shows it again when cleared", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asOwner = t.withIdentity({ subject: "owner-1" });
    const categoryId = await asOwner.mutation(api.categories.create, { name: "General" });
    const channelId = await seedChannel(t, { categoryId });

    const signal = await asOwner.mutation(api.categories.setOverrides, {
      categoryId,
      overrides: [
        { targetId: EVERYONE_ROLE_ID, targetType: "role", allow: 0n, deny: Permission.ViewChannel },
      ],
    });
    expect(signal).toBeNull();

    const asUser = t.withIdentity({ subject: "user-1" });
    const hidden = await asUser.query(api.channels.list, { paginationOpts: PAGE });
    expect(hidden.page.map((channel) => channel.id)).not.toContain(channelId);

    await asOwner.mutation(api.categories.clearOverride, {
      categoryId,
      targetId: EVERYONE_ROLE_ID,
      targetType: "role",
    });
    const visible = await asUser.query(api.channels.list, { paginationOpts: PAGE });
    expect(visible.page.map((channel) => channel.id)).toContain(channelId);
  });

  it("rejects an override that both allows and denies a flag", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const asOwner = t.withIdentity({ subject: "owner-1" });
    const categoryId = await asOwner.mutation(api.categories.create, { name: "General" });

    await expect(
      asOwner.mutation(api.categories.setOverrides, {
        categoryId,
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
  });
});
