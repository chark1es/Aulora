import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { isSealed, openString } from "../convex/lib/sse";
import { EVERYONE_BASE, newTest, seedChannel, seedWorkspace } from "./helpers";

const PAGE = { numItems: 50, cursor: null } as const;

describe("channels.list", () => {
  it("requires authentication", async () => {
    const t = newTest();
    await expect(t.query(api.channels.list, { paginationOpts: PAGE })).rejects.toThrow();
  });

  it("hides channels without ViewChannel", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const publicId = await seedChannel(t, { name: "public" });
    const secretId = await seedChannel(t, {
      name: "secret",
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
    const visible = result.page.find((channel) => channel.id === publicId);
    expect(visible?.name).toBe("public");
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
      await asOwner.mutation(api.channels.create, { kind: "text", name: `chan-${i}` });
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
      asUser.mutation(api.channels.create, { kind: "text", name: "new" }),
    ).rejects.toThrow("Missing permission");
  });

  it("creates a channel and seals its name and topic", async () => {
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
      name: "new",
      topic: "release notes",
    });
    const channel = await t.run(async (ctx) => await ctx.db.get(channelId));
    expect(channel).toMatchObject({ kind: "announcement", archived: false, overrides: [] });
    expect(isSealed(channel?.nameCiphertext ?? "")).toBe(true);
    expect(isSealed(channel?.topicCiphertext ?? "")).toBe(true);

    const summary = await asUser.query(api.channels.get, { channelId });
    expect(summary.name).toBe("new");
    expect(summary.topic).toBe("release notes");
    await expect(
      openString({ scope: "channel.name" }, channel?.nameCiphertext ?? ""),
    ).resolves.toBe("new");
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

    await asUser.mutation(api.channels.rename, { channelId, name: "name" });
    await asUser.mutation(api.channels.setTopic, { channelId, topic: "topic" });
    await asUser.mutation(api.channels.archive, { channelId });
    let channel = await t.run(async (ctx) => await ctx.db.get(channelId));
    expect(channel).toMatchObject({ archived: true });
    expect(isSealed(channel?.nameCiphertext ?? "")).toBe(true);
    expect(isSealed(channel?.topicCiphertext ?? "")).toBe(true);
    await expect(
      openString({ scope: "channel.name" }, channel?.nameCiphertext ?? ""),
    ).resolves.toBe("name");
    await expect(
      openString({ scope: "channel.topic" }, channel?.topicCiphertext ?? ""),
    ).resolves.toBe("topic");

    await asUser.mutation(api.channels.unarchive, { channelId });
    channel = await t.run(async (ctx) => await ctx.db.get(channelId));
    expect(channel?.archived).toBe(false);
  });

  it("clears the topic when set to empty", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.ManageChannels,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t, { topic: "old" });
    const asUser = t.withIdentity({ subject: "user-1" });
    await asUser.mutation(api.channels.setTopic, { channelId, topic: "" });
    const summary = await asUser.query(api.channels.get, { channelId });
    expect(summary.topic).toBeNull();
  });

  it("records audit rows for channel changes", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.ManageChannels,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });
    await asUser.mutation(api.channels.rename, { channelId, name: "name" });

    const audit = await t.run(async (ctx) => await ctx.db.query("auditLog").collect());
    expect(audit.some((row) => row.action === "channel.rename")).toBe(true);
  });

  it("joins and leaves a public channel", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });

    expect(await asUser.mutation(api.channels.join, { channelId })).toEqual({ joined: true });
    expect(await asUser.mutation(api.channels.join, { channelId })).toEqual({ joined: false });
    expect(await asUser.mutation(api.channels.leave, { channelId })).toEqual({ left: true });
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

describe("channels.list with many DMs", () => {
  it("never lets DMs crowd channels out of a page", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    for (let i = 0; i < 4; i += 1) {
      await seedChannel(t, { kind: "dm", memberIds: ["user-1", `user-${i + 10}`] });
    }
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });
    const result = await asUser.query(api.channels.list, {
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(result.page.map((channel) => channel.id)).toEqual([channelId]);
  });
});

describe("private channels", () => {
  it("hides a private channel from non-members even with ViewChannel", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1" }, { userId: "user-2" }],
    });
    const privateId = await seedChannel(t, { private: true, memberIds: ["user-1"] });

    const asMember = t.withIdentity({ subject: "user-1" });
    const asOutsider = t.withIdentity({ subject: "user-2" });

    const memberList = await asMember.query(api.channels.list, { paginationOpts: PAGE });
    expect(memberList.page.map((channel) => channel.id)).toContain(privateId);
    expect(memberList.page[0]?.isPrivate).toBe(true);

    const outsiderList = await asOutsider.query(api.channels.list, { paginationOpts: PAGE });
    expect(outsiderList.page.map((channel) => channel.id)).not.toContain(privateId);
    await expect(asOutsider.query(api.channels.get, { channelId: privateId })).rejects.toThrow(
      "Not a channel member",
    );
  });

  it("refuses a self-join on a private channel", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const privateId = await seedChannel(t, { private: true, memberIds: ["user-1"] });
    const asOutsider = t.withIdentity({ subject: "user-2" });
    await expect(asOutsider.mutation(api.channels.join, { channelId: privateId })).rejects.toThrow(
      "private",
    );
  });

  it("lets a manager add a member to a private channel", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: EVERYONE_BASE | Permission.ManageChannels,
      members: [{ userId: "user-1" }, { userId: "user-2" }],
    });
    const privateId = await seedChannel(t, { private: true, memberIds: ["user-1"] });
    const asMember = t.withIdentity({ subject: "user-1" });

    const result = await asMember.mutation(api.channels.addMember, {
      channelId: privateId,
      userId: "user-2",
    });
    expect(result).toEqual({ added: true });

    const asUser2 = t.withIdentity({ subject: "user-2" });
    const list = await asUser2.query(api.channels.list, { paginationOpts: PAGE });
    expect(list.page.map((channel) => channel.id)).toContain(privateId);
  });

  it("lets a member leave and removes them from the list", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: EVERYONE_BASE | Permission.ManageChannels,
      members: [{ userId: "user-1" }, { userId: "user-2" }],
    });
    const privateId = await seedChannel(t, { private: true, memberIds: ["user-1", "user-2"] });
    const asUser2 = t.withIdentity({ subject: "user-2" });

    const result = await asUser2.mutation(api.channels.removeMember, {
      channelId: privateId,
      userId: "user-2",
    });
    expect(result).toEqual({ removed: true });

    const list = await asUser2.query(api.channels.list, { paginationOpts: PAGE });
    expect(list.page.map((channel) => channel.id)).not.toContain(privateId);
  });

  it("creates a private channel with only the creator as member", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: EVERYONE_BASE | Permission.ManageChannels,
      members: [{ userId: "user-1" }, { userId: "user-2" }],
    });
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const channelId = await asUser1.mutation(api.channels.create, {
      kind: "text",
      name: "private",
      private: true,
    });

    const members = await asUser1.query(api.channels.get, { channelId });
    expect(members.isPrivate).toBe(true);
    expect(members.memberIds).toEqual(["user-1"]);

    const asUser2 = t.withIdentity({ subject: "user-2" });
    const list = await asUser2.query(api.channels.list, { paginationOpts: PAGE });
    expect(list.page.map((channel) => channel.id)).not.toContain(channelId);
  });

  it("adds whitelisted members and roles and grants read+write", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: EVERYONE_BASE | Permission.ManageChannels,
      extraRoles: [{ key: "team", permissions: EVERYONE_BASE }],
      members: [
        { userId: "user-1" },
        { userId: "user-2" },
        { userId: "user-3", roleIds: ["team"] },
      ],
    });
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const channelId = await asUser1.mutation(api.channels.create, {
      kind: "text",
      name: "private",
      private: true,
      memberIds: ["user-2"],
      roleIds: ["team"],
    });

    const summary = await asUser1.query(api.channels.get, { channelId });
    const grant = Permission.ViewChannel | Permission.SendMessages;
    expect([...(summary.memberIds ?? [])].sort()).toEqual(["user-1", "user-2", "user-3"]);
    const roleOverride = summary.overrides?.find(
      (override) => override.targetType === "role" && override.targetId === "team",
    );
    expect(roleOverride).toBeDefined();
    expect(roleOverride?.allow).toBe(grant);
    const memberOverride = summary.overrides?.find(
      (override) => override.targetType === "member" && override.targetId === "user-2",
    );
    expect(memberOverride?.allow).toBe(grant);

    const asUser3 = t.withIdentity({ subject: "user-3" });
    const list = await asUser3.query(api.channels.list, { paginationOpts: PAGE });
    expect(list.page.map((channel) => channel.id)).toContain(channelId);
  });
});

describe("channels.reorder", () => {
  it("assigns increasing positions to new channels in a category", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: EVERYONE_BASE | Permission.ManageChannels,
      members: [{ userId: "user-1" }],
    });
    const categoryId = await t.run(
      async (ctx) => await ctx.db.insert("categories", { name: "cat", position: 0, overrides: [] }),
    );
    const asUser = t.withIdentity({ subject: "user-1" });
    const first = await asUser.mutation(api.channels.create, {
      kind: "text",
      name: "first",
      categoryId,
    });
    const second = await asUser.mutation(api.channels.create, {
      kind: "text",
      name: "second",
      categoryId,
    });

    expect((await asUser.query(api.channels.get, { channelId: first })).position).toBe(0);
    expect((await asUser.query(api.channels.get, { channelId: second })).position).toBe(1);
  });

  it("moves a channel's position and category, clearing it with null", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: EVERYONE_BASE | Permission.ManageChannels,
      members: [{ userId: "user-1" }],
    });
    const [catA, catB] = await t.run(async (ctx) => [
      await ctx.db.insert("categories", { name: "a", position: 0, overrides: [] }),
      await ctx.db.insert("categories", { name: "b", position: 1, overrides: [] }),
    ]);
    const asUser = t.withIdentity({ subject: "user-1" });
    const channelId = await asUser.mutation(api.channels.create, {
      kind: "text",
      name: "chan",
      categoryId: catA,
    });

    await asUser.mutation(api.channels.reorder, {
      moves: [{ channelId, categoryId: catB, position: 3 }],
    });
    let summary = await asUser.query(api.channels.get, { channelId });
    expect(summary.position).toBe(3);
    expect(summary.categoryId).toBe(catB);

    await asUser.mutation(api.channels.reorder, {
      moves: [{ channelId, categoryId: null, position: 0 }],
    });
    summary = await asUser.query(api.channels.get, { channelId });
    expect(summary.categoryId).toBeNull();

    const audit = await t.run(async (ctx) => await ctx.db.query("auditLog").collect());
    expect(audit.some((row) => row.action === "channel.reorder")).toBe(true);
  });
});

describe("channels.visibleMemberIds", () => {
  it("excludes a member denied ViewChannel by an override", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1" }, { userId: "user-2" }, { userId: "user-3" }],
    });
    const channelId = await seedChannel(t, {
      overrides: [
        {
          targetId: "user-2",
          targetType: "member",
          allow: 0n,
          deny: Permission.ViewChannel,
        },
      ],
    });

    const asUser1 = t.withIdentity({ subject: "user-1" });
    const visible = await asUser1.query(api.channels.visibleMemberIds, { channelId });
    expect(visible).toContain("user-1");
    expect(visible).toContain("user-3");
    expect(visible).not.toContain("user-2");
  });

  it("excludes non-members of a private channel", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: EVERYONE_BASE | Permission.ManageChannels,
      members: [{ userId: "user-1" }, { userId: "user-2" }],
    });
    const privateId = await seedChannel(t, { private: true, memberIds: ["user-1"] });

    const asUser1 = t.withIdentity({ subject: "user-1" });
    const visible = await asUser1.query(api.channels.visibleMemberIds, { channelId: privateId });
    expect(visible).toEqual(["user-1"]);
  });
});
