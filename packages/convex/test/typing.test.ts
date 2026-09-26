import { Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

describe("typing", () => {
  it("sets, lists and clears typing state", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t);
    const asUser1 = t.withIdentity({ subject: "user-1" });

    const { expiresAt } = await asUser1.mutation(api.typing.set, { channelId });
    expect(expiresAt).toBeGreaterThan(Date.now());

    const listed = await asUser1.query(api.typing.list, { channelId });
    expect(listed.map((row) => row.userId)).toEqual(["user-1"]);

    await asUser1.mutation(api.typing.clear, { channelId });
    expect(await asUser1.query(api.typing.list, { channelId })).toEqual([]);
  });

  it("hides expired rows and purges them", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("typing", {
        channelId,
        userId: "user-1",
        expiresAt: Date.now() - 1_000,
      });
      await ctx.db.insert("typing", {
        channelId,
        userId: "user-2",
        expiresAt: Date.now() + 60_000,
      });
    });

    const asUser1 = t.withIdentity({ subject: "user-1" });
    const listed = await asUser1.query(api.typing.list, { channelId });
    expect(listed.map((row) => row.userId)).toEqual(["user-2"]);

    const purged = await t.mutation(internal.typing.purgeExpired, {});
    expect(purged).toBe(1);
    const remaining = await t.run(async (ctx) => await ctx.db.query("typing").collect());
    expect(remaining.map((row) => row.userId)).toEqual(["user-2"]);
  });

  it("requires ViewChannel to set typing", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ReadHistory,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t);
    const asUser1 = t.withIdentity({ subject: "user-1" });
    await expect(asUser1.mutation(api.typing.set, { channelId })).rejects.toThrow(
      "Missing permission",
    );
  });
});
