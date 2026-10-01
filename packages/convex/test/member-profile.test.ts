import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { isSealed } from "../convex/lib/sse";
import { newTest, seedWorkspace } from "./helpers";

describe("member profiles", () => {
  it("saves a sealed bio on the caller and lets other members read it", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "ada" }, { userId: "bob" }] });
    const ada = t.withIdentity({ subject: "ada" });
    const bob = t.withIdentity({ subject: "bob" });
    await ada.mutation(api.members.setBio, { bio: "  Building things.\nSay hello!  " });
    expect(await bob.query(api.members.profile, { userId: "ada" })).toMatchObject({
      bio: "Building things.\nSay hello!",
      lastOnlineAt: null,
    });
    const rows = await t.run(async (ctx) => ctx.db.query("members").collect());
    expect(isSealed(rows.find((row) => row.userId === "ada")?.bioCiphertext ?? "")).toBe(true);
    expect(rows.find((row) => row.userId === "bob")?.bioCiphertext).toBeUndefined();

    await ada.mutation(api.members.setBio, { bio: "   " });
    expect((await bob.query(api.members.profile, { userId: "ada" }))?.bio).toBeNull();
    await expect(ada.mutation(api.members.setBio, { bio: "a".repeat(501) })).rejects.toThrow(
      "500 characters",
    );
  });

  it("requires workspace membership to view or edit profiles", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "ada" }] });
    await expect(t.query(api.members.profile, { userId: "ada" })).rejects.toThrow();
    const outsider = t.withIdentity({ subject: "outsider" });
    await expect(outsider.query(api.members.profile, { userId: "ada" })).rejects.toThrow();
    await expect(outsider.mutation(api.members.setBio, { bio: "Hello" })).rejects.toThrow();
    expect(
      await t.withIdentity({ subject: "ada" }).query(api.members.profile, { userId: "missing" }),
    ).toBeNull();
  });

  it("preserves the last online time when invisible heartbeats continue", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "ada" }] });
    const ada = t.withIdentity({ subject: "ada" });
    await t.run(async (ctx) => {
      await ctx.db.insert("presence", {
        userId: "ada",
        status: "online",
        lastHeartbeat: 1_000,
      });
    });
    await ada.mutation(api.presence.setStatus, { status: "offline" });
    await ada.mutation(api.presence.heartbeat, {});
    expect((await ada.query(api.members.profile, { userId: "ada" }))?.lastOnlineAt).toBe(1_000);
    await ada.mutation(api.presence.setStatus, { status: "dnd" });
    const before = (await ada.query(api.members.profile, { userId: "ada" }))?.lastOnlineAt;
    expect(before).toBeGreaterThan(1_000);
    await ada.mutation(api.presence.heartbeat, {});
    expect(
      (await ada.query(api.members.profile, { userId: "ada" }))?.lastOnlineAt,
    ).toBeGreaterThanOrEqual(before ?? 0);
  });

  it("does not infer online activity from a legacy invisible session", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "ada" }] });
    await t.run(async (ctx) => {
      await ctx.db.insert("presence", {
        userId: "ada",
        status: "offline",
        manual: true,
        lastHeartbeat: Date.now(),
      });
    });
    expect(
      (await t.withIdentity({ subject: "ada" }).query(api.members.profile, { userId: "ada" }))
        ?.lastOnlineAt,
    ).toBeNull();
  });

  it("keeps a profile picture on this workspace and falls back when it is cleared", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "ada" }, { userId: "bob" }] });
    const ada = t.withIdentity({ subject: "ada" });
    const imageId = await t.run(async (ctx) => {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      return await ctx.storage.store(new Blob([bytes], { type: "image/png" }));
    });
    await ada.mutation(api.members.setAvatar, { storageId: imageId });
    const listed = await t.withIdentity({ subject: "bob" }).query(api.members.list, {});
    expect(listed.find((member) => member.userId === "ada")?.avatarUrl).toEqual(expect.any(String));
    expect(listed.find((member) => member.userId === "bob")?.avatarUrl).toBeNull();
    expect((await ada.query(api.members.profile, { userId: "ada" }))?.avatarUrl).toEqual(
      expect.any(String),
    );

    const emptyId = await t.run(
      async (ctx) => await ctx.storage.store(new Blob([new Uint8Array(0)])),
    );
    await expect(ada.mutation(api.members.setAvatar, { storageId: emptyId })).rejects.toThrow(
      /image/,
    );

    await ada.mutation(api.members.setAvatar, {});
    const cleared = await ada.query(api.members.list, {});
    expect(cleared.find((member) => member.userId === "ada")?.avatarUrl).toBeNull();
    await expect(
      t.withIdentity({ subject: "outsider" }).mutation(api.members.setAvatar, {}),
    ).rejects.toThrow();
  });
});
