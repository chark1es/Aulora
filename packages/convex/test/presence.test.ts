import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { newTest, seedWorkspace } from "./helpers";

describe("presence", () => {
  it("creates presence on heartbeat", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asUser1 = t.withIdentity({ subject: "user-1" });

    const result = await asUser1.mutation(api.presence.heartbeat, { status: "online" });
    expect(result.status).toBe("online");
    expect(result.lastHeartbeat).toBeTypeOf("number");

    const list = await asUser1.query(api.presence.list);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ userId: "user-1", status: "online" });
  });

  it("stores an opaque custom status", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asUser1 = t.withIdentity({ subject: "user-1" });
    await asUser1.mutation(api.presence.setStatus, {
      status: "dnd",
      customStatusCiphertext: "Y3VzdG9t",
    });
    const presence = await asUser1.query(api.presence.get, { userId: "user-1" });
    expect(presence).toMatchObject({
      status: "dnd",
      customStatusCiphertext: "Y3VzdG9t",
    });
  });

  it("sweeps stale sessions to idle then offline, preserving dnd", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("presence", {
        userId: "idle-user",
        status: "online",
        lastHeartbeat: now - 70_000,
      });
      await ctx.db.insert("presence", {
        userId: "offline-user",
        status: "online",
        lastHeartbeat: now - 200_000,
      });
      await ctx.db.insert("presence", {
        userId: "dnd-user",
        status: "dnd",
        lastHeartbeat: now - 70_000,
      });
    });

    const changed = await t.mutation(internal.presence.sweepStale, {});
    expect(changed).toBe(2);

    const rows = await t.run(async (ctx) => await ctx.db.query("presence").collect());
    const byUser = new Map(rows.map((row) => [row.userId, row.status]));
    expect(byUser.get("idle-user")).toBe("idle");
    expect(byUser.get("offline-user")).toBe("offline");
    expect(byUser.get("dnd-user")).toBe("dnd");
  });

  it("requires authentication", async () => {
    const t = newTest();
    await expect(t.mutation(api.presence.heartbeat, {})).rejects.toThrow();
  });
});
