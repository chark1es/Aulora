import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { isSealed, openString } from "../convex/lib/sse";
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

  it("seals the custom status and reads it back decrypted", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asUser1 = t.withIdentity({ subject: "user-1" });
    await asUser1.mutation(api.presence.setStatus, {
      status: "dnd",
      customStatus: "heads down",
    });
    const presence = await asUser1.query(api.presence.get, { userId: "user-1" });
    expect(presence).toMatchObject({
      status: "dnd",
      customStatus: "heads down",
    });

    const rows = await t.run(async (ctx) => await ctx.db.query("presence").collect());
    expect(isSealed(rows[0]?.customStatusCiphertext ?? "")).toBe(true);
    await expect(
      openString({ scope: "presence.status" }, rows[0]?.customStatusCiphertext ?? ""),
    ).resolves.toBe("heads down");
  });

  it("clears the custom status on an empty value", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asUser1 = t.withIdentity({ subject: "user-1" });
    await asUser1.mutation(api.presence.setStatus, { status: "online", customStatus: "busy" });
    await asUser1.mutation(api.presence.setStatus, { status: "online", customStatus: "" });
    const presence = await asUser1.query(api.presence.get, { userId: "user-1" });
    expect(presence?.customStatus).toBeNull();
  });

  it("keeps the custom status when a status-only update omits it", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asUser1 = t.withIdentity({ subject: "user-1" });
    await asUser1.mutation(api.presence.setStatus, { status: "online", customStatus: "busy" });
    await asUser1.mutation(api.presence.setStatus, { status: "dnd" });
    const presence = await asUser1.query(api.presence.get, { userId: "user-1" });
    expect(presence).toMatchObject({ status: "dnd", customStatus: "busy" });
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

  it("defaults a bare heartbeat to an automatic online row", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asUser1 = t.withIdentity({ subject: "user-1" });

    const result = await asUser1.mutation(api.presence.heartbeat, {});
    expect(result.status).toBe("online");

    const rows = await t.run(async (ctx) => await ctx.db.query("presence").collect());
    expect(rows[0]).toMatchObject({ userId: "user-1", status: "online" });
    expect(rows[0]?.manual ?? false).toBe(false);
  });

  it("keeps a manual status through a heartbeat but refreshes the timestamp", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asUser1 = t.withIdentity({ subject: "user-1" });
    await asUser1.mutation(api.presence.setStatus, { status: "dnd" });
    const before = await t.run(async (ctx) => await ctx.db.query("presence").collect());
    const firstHeartbeat = before[0]?.lastHeartbeat ?? 0;

    await new Promise((resolve) => setTimeout(resolve, 5));
    const result = await asUser1.mutation(api.presence.heartbeat, { status: "online" });
    expect(result.status).toBe("dnd");

    const after = await t.run(async (ctx) => await ctx.db.query("presence").collect());
    expect(after[0]).toMatchObject({ status: "dnd", manual: true });
    expect(after[0]?.lastHeartbeat ?? 0).toBeGreaterThan(firstHeartbeat);
  });

  it("leaves a manual row untouched when it is stale past the offline threshold", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    await t.run(async (ctx) => {
      await ctx.db.insert("presence", {
        userId: "manual-user",
        status: "dnd",
        manual: true,
        lastHeartbeat: Date.now() - 200_000,
      });
    });

    const changed = await t.mutation(internal.presence.sweepStale, {});
    expect(changed).toBe(0);

    const rows = await t.run(async (ctx) => await ctx.db.query("presence").collect());
    expect(rows[0]).toMatchObject({ status: "dnd", manual: true });
  });

  it("clears manual on setStatus('online') so the sweep resumes", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asUser1 = t.withIdentity({ subject: "user-1" });
    await asUser1.mutation(api.presence.setStatus, { status: "dnd" });
    await asUser1.mutation(api.presence.setStatus, { status: "online" });

    const rows = await t.run(async (ctx) => await ctx.db.query("presence").collect());
    expect(rows[0]?.manual).toBe(false);
    const row = rows[0];
    if (row === undefined) {
      throw new Error("expected a presence row");
    }

    await t.run(async (ctx) => {
      await ctx.db.patch(row._id, { lastHeartbeat: Date.now() - 200_000 });
    });
    const changed = await t.mutation(internal.presence.sweepStale, {});
    expect(changed).toBe(1);

    const after = await t.run(async (ctx) => await ctx.db.query("presence").collect());
    expect(after[0]?.status).toBe("offline");
  });
});

describe("presence.getMany", () => {
  it("returns the same rows as presence.list for the requested ids, deduped", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1" }, { userId: "user-2" }, { userId: "user-3" }],
    });
    const asUser1 = t.withIdentity({ subject: "user-1" });
    await asUser1.mutation(api.presence.heartbeat, { status: "online" });
    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.presence.setStatus, { status: "dnd", customStatus: "heads down" });

    const listed = await asUser1.query(api.presence.list);
    const many = await asUser1.query(api.presence.getMany, {
      // Order preserved, duplicate collapsed, unknown id skipped.
      userIds: ["user-2", "user-1", "user-2", "missing"],
    });

    expect(many.map((row) => row.userId)).toEqual(["user-2", "user-1"]);
    const byUser = new Map(listed.map((row) => [row.userId, row]));
    for (const row of many) {
      expect(row).toEqual(byUser.get(row.userId));
    }
  });

  it("caps how many ids it looks up", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const ids = Array.from({ length: 301 }, (_, i) => `u${i}`);
    await t.run(async (ctx) => {
      for (const userId of ids) {
        await ctx.db.insert("presence", { userId, status: "online", lastHeartbeat: 1 });
      }
    });

    const rows = await asUser1.query(api.presence.getMany, { userIds: ids });
    expect(rows.map((row) => row.userId)).toEqual(ids.slice(0, 300));
  });

  it("requires workspace membership", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    await expect(t.query(api.presence.getMany, { userIds: ["user-1"] })).rejects.toThrow();
  });
});

describe("presence retention", () => {
  it("keeps a deliberately chosen manual status past the retention window", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "manual" }] });
    await t.run(async (ctx) => {
      await ctx.db.insert("presence", {
        userId: "manual",
        status: "dnd",
        lastHeartbeat: Date.now() - 60 * 24 * 60 * 60 * 1000,
        manual: true,
      });
    });
    await t.mutation(internal.presence.pruneStalePresence, {});
    const rows = await t.run(async (ctx) => await ctx.db.query("presence").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: "manual", manual: true });
  });
});
