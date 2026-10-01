import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, seedWorkspace } from "./helpers";

describe("notes", () => {
  it("round-trips a private note and never leaks it to another user", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1" }, { userId: "user-2" }, { userId: "user-3" }],
    });
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const asUser2 = t.withIdentity({ subject: "user-2" });

    await asUser1.mutation(api.notes.upsert, { targetUserId: "user-2", body: "watch this" });
    expect(await asUser1.query(api.notes.get, { targetUserId: "user-2" })).toEqual({
      body: "watch this",
    });
    expect(await asUser1.query(api.notes.list)).toEqual([
      { targetUserId: "user-2", body: "watch this" },
    ]);

    // Another user has their own (empty) note about the same target.
    expect(await asUser2.query(api.notes.get, { targetUserId: "user-2" })).toEqual({ body: null });
    expect(await asUser2.query(api.notes.list)).toEqual([]);
    expect(await t.withIdentity({ subject: "user-3" }).query(api.notes.list)).toEqual([]);
  });

  it("updates in place, seals the body and deletes on an empty body", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const asUser1 = t.withIdentity({ subject: "user-1" });

    await asUser1.mutation(api.notes.upsert, { targetUserId: "user-2", body: "first" });
    await asUser1.mutation(api.notes.upsert, { targetUserId: "user-2", body: "second" });
    expect(await asUser1.query(api.notes.get, { targetUserId: "user-2" })).toEqual({
      body: "second",
    });

    const rows = await t.run(async (ctx) => await ctx.db.query("userNotes").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.bodyCiphertext).not.toContain("second");

    await asUser1.mutation(api.notes.upsert, { targetUserId: "user-2", body: "" });
    expect(await asUser1.query(api.notes.get, { targetUserId: "user-2" })).toEqual({ body: null });
    expect(await t.run(async (ctx) => await ctx.db.query("userNotes").collect())).toHaveLength(0);
  });

  it("requires authentication", async () => {
    const t = newTest();
    await seedWorkspace(t);
    await expect(t.query(api.notes.list)).rejects.toThrow("Not authenticated");
  });

  it("keeps distinct notes for ids that a plain separator would collide", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "a:b" }, { userId: "a" }] });
    const asAmbiguous = t.withIdentity({ subject: "a:b" });
    const asPlain = t.withIdentity({ subject: "a" });

    await asAmbiguous.mutation(api.notes.upsert, { targetUserId: "c", body: "first" });
    await asPlain.mutation(api.notes.upsert, { targetUserId: "b:c", body: "second" });

    expect(await asAmbiguous.query(api.notes.get, { targetUserId: "c" })).toEqual({
      body: "first",
    });
    expect(await asPlain.query(api.notes.get, { targetUserId: "b:c" })).toEqual({ body: "second" });
    const rows = await t.run(async (ctx) => await ctx.db.query("userNotes").collect());
    expect(rows).toHaveLength(2);
  });
});
