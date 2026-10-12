import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

const PAGE = { numItems: 50, cursor: null } as const;

async function seedDirect() {
  const t = newTest();
  await seedWorkspace(t, {
    members: [{ userId: "user-1" }, { userId: "user-2" }, { userId: "user-3" }],
  });
  const asUser1 = t.withIdentity({ subject: "user-1" });
  const { channelId } = await asUser1.mutation(api.channels.createDm, { otherUserId: "user-2" });
  return { t, asUser1, channelId };
}

describe("channels.setPinned", () => {
  it("pins a DM for the caller and exposes it on listDms and get", async () => {
    const { t, asUser1, channelId } = await seedDirect();

    await asUser1.mutation(api.channels.setPinned, { channelId, pinned: true });

    const dms = await asUser1.query(api.channels.listDms, { paginationOpts: PAGE });
    const summary = dms.page.find((channel) => channel.id === channelId);
    expect(summary).toMatchObject({ pinned: true });
    expect(typeof summary?.pinnedAt).toBe("number");

    const fetched = await asUser1.query(api.channels.get, { channelId });
    expect(fetched).toMatchObject({ pinned: true });
    expect(typeof fetched.pinnedAt).toBe("number");

    const prefs = await t.run(async (ctx) => {
      const rows = await ctx.db.query("notificationPrefs").collect();
      return rows.find((row) => row.userId === "user-1" && row.channelId === channelId);
    });
    expect(prefs).toMatchObject({ pinned: true });
  });

  it("unpins a DM and clears pinnedAt", async () => {
    const { asUser1, channelId } = await seedDirect();
    await asUser1.mutation(api.channels.setPinned, { channelId, pinned: true });

    await asUser1.mutation(api.channels.setPinned, { channelId, pinned: false });

    const fetched = await asUser1.query(api.channels.get, { channelId });
    expect(fetched).toMatchObject({ pinned: false, pinnedAt: null });
  });

  it("pins a group DM", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1" }, { userId: "user-2" }, { userId: "user-3" }],
    });
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const { channelId } = await asUser1.mutation(api.channels.createGroupDm, {
      memberIds: ["user-2", "user-3"],
    });

    await asUser1.mutation(api.channels.setPinned, { channelId, pinned: true });

    const dms = await asUser1.query(api.channels.listDms, { paginationOpts: PAGE });
    expect(dms.page.find((channel) => channel.id === channelId)?.pinned).toBe(true);
  });

  it("keeps a pin private to the viewer", async () => {
    const { t, asUser1, channelId } = await seedDirect();
    const asUser2 = t.withIdentity({ subject: "user-2" });

    await asUser1.mutation(api.channels.setPinned, { channelId, pinned: true });

    const dms = await asUser2.query(api.channels.listDms, { paginationOpts: PAGE });
    expect(dms.page.find((channel) => channel.id === channelId)).toMatchObject({
      pinned: false,
      pinnedAt: null,
    });
    expect((await asUser2.query(api.notifications.getPrefs)).length).toBe(0);
  });

  it("keeps the viewer's server-wide notification level when pinning", async () => {
    const { t, asUser1, channelId } = await seedDirect();
    await t.run(async (ctx) => {
      await ctx.db.insert("notificationPrefs", {
        userId: "user-1",
        scope: "server",
        level: "mentions",
      });
    });

    await asUser1.mutation(api.channels.setPinned, { channelId, pinned: true });

    const row = await t.run(async (ctx) => {
      const rows = await ctx.db.query("notificationPrefs").collect();
      return rows.find((entry) => entry.scope === "channel" && entry.channelId === channelId);
    });
    expect(row).toMatchObject({ level: "mentions", pinned: true });
  });

  it("rejects a caller who is not a participant", async () => {
    const { t, channelId } = await seedDirect();
    const asUser3 = t.withIdentity({ subject: "user-3" });

    await expect(
      asUser3.mutation(api.channels.setPinned, { channelId, pinned: true }),
    ).rejects.toThrow("Not a channel member");
  });

  it("rejects a non-DM channel", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { memberIds: ["user-1"] });
    const asUser1 = t.withIdentity({ subject: "user-1" });

    await expect(
      asUser1.mutation(api.channels.setPinned, { channelId, pinned: true }),
    ).rejects.toThrow("Only direct messages can be pinned");
  });

  it("requires authentication", async () => {
    const { t, channelId } = await seedDirect();
    await expect(t.mutation(api.channels.setPinned, { channelId, pinned: true })).rejects.toThrow(
      "Not authenticated",
    );
  });
});
