import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

const PAGE = { numItems: 50, cursor: null } as const;

describe("channels.list", () => {
  it("requires authentication", async () => {
    const t = newTest();
    await expect(t.query(api.channels.list, { paginationOpts: PAGE })).rejects.toThrow();
  });

  it("hides channels without ViewChannel", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const publicId = await seedChannel(t, { nameCiphertext: "cHVibGlj" });
    const secretId = await seedChannel(t, {
      nameCiphertext: "c2VjcmV0",
      overrides: [
        {
          targetId: EVERYONE_ROLE_ID,
          targetType: "role",
          allow: 0n,
          deny: Permission.ViewChannel,
        },
      ],
    });

    const asUser = t.withIdentity({ subject: "user-1" });
    const result = await asUser.query(api.channels.list, { paginationOpts: PAGE });
    const ids = result.page.map((channel) => channel.id);

    expect(ids).toContain(publicId);
    expect(ids).not.toContain(secretId);
  });

  it("shows every channel to the workspace owner", async () => {
    const t = newTest();
    await seedWorkspace(t, { ownerId: "owner-1", members: [{ userId: "owner-1" }] });
    const secretId = await seedChannel(t, {
      overrides: [
        {
          targetId: EVERYONE_ROLE_ID,
          targetType: "role",
          allow: 0n,
          deny: Permission.ViewChannel,
        },
      ],
    });

    const asOwner = t.withIdentity({ subject: "owner-1" });
    const result = await asOwner.query(api.channels.list, { paginationOpts: PAGE });
    expect(result.page.map((channel) => channel.id)).toContain(secretId);
  });

  it("paginates the visible channels", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ManageChannels,
      members: [{ userId: "owner-1" }],
    });
    const asOwner = t.withIdentity({ subject: "owner-1" });
    for (let i = 0; i < 3; i += 1) {
      await asOwner.mutation(api.channels.create, { kind: "text" });
    }

    const first = await asOwner.query(api.channels.list, {
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);
    const second = await asOwner.query(api.channels.list, {
      paginationOpts: { numItems: 2, cursor: first.continueCursor },
    });
    expect(second.page).toHaveLength(1);
    expect(second.isDone).toBe(true);
  });

  it("hides DMs from the channel list and exposes them via listDms", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1" }, { userId: "user-2" }],
    });
    const asUser = t.withIdentity({ subject: "user-1" });
    const { channelId } = await asUser.mutation(api.channels.createDm, { otherUserId: "user-2" });

    const channels = await asUser.query(api.channels.list, { paginationOpts: PAGE });
    expect(channels.page.map((channel) => channel.id)).not.toContain(channelId);

    const dms = await asUser.query(api.channels.listDms, { paginationOpts: PAGE });
    expect(dms.page.map((channel) => channel.id)).toContain(channelId);
  });
});

describe("channels.create", () => {
  it("requires ManageChannels", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asUser = t.withIdentity({ subject: "user-1" });
    await expect(
      asUser.mutation(api.channels.create, { kind: "text", nameCiphertext: "bmV3" }),
    ).rejects.toThrow("Missing permission");
  });

  it("creates a channel for a member with ManageChannels", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel,
      extraRoles: [
        {
          key: "manager",
          permissions: Permission.ViewChannel | Permission.ManageChannels,
        },
      ],
      members: [{ userId: "user-1", roleIds: ["manager"] }],
    });

    const asUser = t.withIdentity({ subject: "user-1" });
    const channelId = await asUser.mutation(api.channels.create, {
      kind: "announcement",
      nameCiphertext: "bmV3",
    });
    const channel = await t.run(async (ctx) => await ctx.db.get(channelId));
    expect(channel).toMatchObject({ kind: "announcement", archived: false, overrides: [] });
  });
});

describe("channels mutations", () => {
  it("renames, sets the topic, archives and unarchives with ManageChannels", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.ManageChannels,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });

    await asUser.mutation(api.channels.rename, { channelId, nameCiphertext: "bmFtZQ==" });
    await asUser.mutation(api.channels.setTopic, { channelId, topicCiphertext: "dG9waWM=" });
    await asUser.mutation(api.channels.archive, { channelId });
    let channel = await t.run(async (ctx) => await ctx.db.get(channelId));
    expect(channel).toMatchObject({
      nameCiphertext: "bmFtZQ==",
      topicCiphertext: "dG9waWM=",
      archived: true,
    });

    await asUser.mutation(api.channels.unarchive, { channelId });
    channel = await t.run(async (ctx) => await ctx.db.get(channelId));
    expect(channel?.archived).toBe(false);
  });

  it("records audit rows for channel changes", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.ManageChannels,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });
    await asUser.mutation(api.channels.rename, { channelId, nameCiphertext: "bmFtZQ==" });

    const audit = await t.run(async (ctx) => await ctx.db.query("auditLog").collect());
    expect(audit.some((row) => row.action === "channel.rename")).toBe(true);
  });

  it("joins and leaves a public channel with an MLS action", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });

    expect(await asUser.mutation(api.channels.join, { channelId })).toEqual({
      joined: true,
      mlsAction: "add",
    });
    expect(await asUser.mutation(api.channels.join, { channelId })).toEqual({
      joined: true,
      mlsAction: null,
    });
    expect(await asUser.mutation(api.channels.leave, { channelId })).toEqual({
      left: true,
      mlsAction: "remove",
    });
    const members = await t.run(async (ctx) => await ctx.db.query("channelMembers").collect());
    expect(members).toHaveLength(0);
  });

  it("refuses to join a channel without ViewChannel", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, {
      overrides: [
        {
          targetId: EVERYONE_ROLE_ID,
          targetType: "role",
          allow: 0n,
          deny: Permission.ViewChannel,
        },
      ],
    });
    const asUser = t.withIdentity({ subject: "user-1" });
    await expect(asUser.mutation(api.channels.join, { channelId })).rejects.toThrow(
      "Missing permission",
    );
  });

  it("sets an MLS group id once and refuses to fork it", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });

    await asUser.mutation(api.channels.setMlsGroupId, { channelId, mlsGroupId: "group-1" });
    await asUser.mutation(api.channels.setMlsGroupId, { channelId, mlsGroupId: "group-1" });
    await expect(
      asUser.mutation(api.channels.setMlsGroupId, { channelId, mlsGroupId: "group-2" }),
    ).rejects.toThrow("already has an MLS group");

    const channel = await t.run(async (ctx) => await ctx.db.get(channelId));
    expect(channel?.mlsGroupId).toBe("group-1");
  });
});

describe("channels DM dedupe", () => {
  it("reuses the same DM channel for the same pair", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const asUser = t.withIdentity({ subject: "user-1" });

    const first = await asUser.mutation(api.channels.createDm, { otherUserId: "user-2" });
    const second = await asUser.mutation(api.channels.createDm, { otherUserId: "user-2" });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.channelId).toBe(first.channelId);
  });

  it("computes the same dm key regardless of participant order", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1" }, { userId: "user-2" }, { userId: "user-3" }],
    });
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const asUser2 = t.withIdentity({ subject: "user-2" });

    const a = await asUser1.mutation(api.channels.createGroupDm, {
      memberIds: ["user-2", "user-3"],
    });
    const b = await asUser2.mutation(api.channels.createGroupDm, {
      memberIds: ["user-1", "user-3"],
    });
    expect(b.channelId).toBe(a.channelId);
  });
});
