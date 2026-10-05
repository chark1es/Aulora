import { Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, seedChannel, seedWorkspace, storeBlob, type Test } from "./helpers";

const PAGE = { numItems: 50, cursor: null } as const;

function tokenFromUrl(url: string): string {
  const token = new URL(url, "http://localhost").searchParams.get("token");
  if (!token) {
    throw new Error("URL did not carry a download token");
  }
  return token;
}

/**
 * A workspace with one real member and a signed-in outsider who has no
 * `members` row. The member authors one message so reactions/reads have a
 * target.
 */
async function outsiderSetup() {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "member-1" }] });
  const channelId = await seedChannel(t, { name: "general" });
  const asMember = t.withIdentity({ subject: "member-1" });
  const messageId = await asMember.mutation(api.messages.send, { channelId, body: "aGk=" });
  return {
    t,
    channelId,
    messageId,
    asMember,
    asOutsider: t.withIdentity({ subject: "outsider" }),
  };
}

describe("C1 membership gate", () => {
  it("rejects a signed-in non-member from workspace and channel reads/writes", async () => {
    const { channelId, messageId, asOutsider } = await outsiderSetup();

    await expect(asOutsider.query(api.channels.list, { paginationOpts: PAGE })).rejects.toThrow(
      "Not a member",
    );
    await expect(
      asOutsider.mutation(api.messages.send, { channelId, body: "eA==" }),
    ).rejects.toThrow("Not a member");
    await expect(
      asOutsider.query(api.messages.list, { channelId, paginationOpts: PAGE }),
    ).rejects.toThrow("Not a member");
    await expect(
      asOutsider.mutation(api.reactions.toggle, { messageId, emoji: "eA==" }),
    ).rejects.toThrow("Not a member");
    await expect(asOutsider.mutation(api.typing.set, { channelId })).rejects.toThrow(
      "Not a member",
    );
    await expect(asOutsider.mutation(api.channels.join, { channelId })).rejects.toThrow(
      "Not a member",
    );
    await expect(
      asOutsider.mutation(api.channels.createDm, { otherUserId: "member-1" }),
    ).rejects.toThrow("Not a member");
  });

  it("rejects a signed-in non-member from presence and member/role/category reads", async () => {
    const { asOutsider } = await outsiderSetup();

    await expect(asOutsider.mutation(api.presence.heartbeat, {})).rejects.toThrow("Not a member");
    await expect(asOutsider.mutation(api.presence.setStatus, { status: "online" })).rejects.toThrow(
      "Not a member",
    );
    await expect(asOutsider.query(api.presence.list)).rejects.toThrow("Not a member");
    await expect(asOutsider.query(api.presence.get, { userId: "member-1" })).rejects.toThrow(
      "Not a member",
    );
    await expect(asOutsider.query(api.members.list)).rejects.toThrow("Not a member");
    await expect(asOutsider.query(api.roles.list)).rejects.toThrow("Not a member");
    await expect(asOutsider.query(api.categories.list)).rejects.toThrow("Not a member");
  });

  it("rejects a signed-in non-member from file access", async () => {
    const { t, asOutsider } = await outsiderSetup();
    await expect(asOutsider.mutation(api.files.generateUploadUrl, {})).rejects.toThrow(
      "Not a member",
    );
    const storageId = await storeBlob(t, 8);
    await expect(
      asOutsider.action(api.files.finalize, {
        storageId,
        name: "x",
        mime: "text/plain",
        sizeBytes: 8,
      }),
    ).rejects.toThrow("Not a member");
    await expect(asOutsider.query(api.files.getMany, { fileIds: [] })).rejects.toThrow(
      "Not a member",
    );
  });

  it("still lets the workspace owner through without a members row", async () => {
    const t = newTest();
    await seedWorkspace(t, { ownerId: "owner-1", members: [] });
    await seedChannel(t, { name: "general" });
    const asOwner = t.withIdentity({ subject: "owner-1" });
    const page = await asOwner.query(api.channels.list, { paginationOpts: PAGE });
    expect(page.page).toHaveLength(1);
  });
});

async function timeoutUser(t: Test, userId: string, until: number): Promise<void> {
  await t.run(async (ctx) => {
    const members = await ctx.db.query("members").collect();
    const member = members.find((entry) => entry.userId === userId) ?? null;
    if (member !== null) {
      await ctx.db.patch(member._id, { timeoutUntil: until });
    }
  });
}

describe("C2/C3 ban and timeout", () => {
  it("stops a timed-out member from sending, reacting and typing", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "author" }] });
    const channelId = await seedChannel(t);
    const asAuthor = t.withIdentity({ subject: "author" });
    const messageId = await asAuthor.mutation(api.messages.send, { channelId, body: "aGk=" });
    await timeoutUser(t, "user-1", Date.now() + 60_000);
    const asUser = t.withIdentity({ subject: "user-1" });

    await expect(asUser.mutation(api.messages.send, { channelId, body: "eA==" })).rejects.toThrow(
      "timed out",
    );
    await expect(
      asUser.mutation(api.reactions.toggle, { messageId, emoji: "eA==" }),
    ).rejects.toThrow("timed out");
    await expect(asUser.mutation(api.typing.set, { channelId })).rejects.toThrow("timed out");
  });

  it("stops a banned member from sending and a banned non-member from reading", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "author" }] });
    const channelId = await seedChannel(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("bans", { userId: "user-1", actorId: "owner-1", at: Date.now() });
    });
    const asUser = t.withIdentity({ subject: "user-1" });
    await expect(asUser.mutation(api.messages.send, { channelId, body: "eA==" })).rejects.toThrow(
      "banned",
    );

    // A banned user normally has no members row at all (ban removes it), so the
    // membership gate itself stops a read.
    await t.run(async (ctx) => {
      const members = await ctx.db.query("members").collect();
      const member = members.find((entry) => entry.userId === "user-1") ?? null;
      if (member !== null) {
        await ctx.db.delete(member._id);
      }
    });
    await expect(
      asUser.query(api.messages.list, { channelId, paginationOpts: PAGE }),
    ).rejects.toThrow("Not a member");
  });
});

describe("C4 file authorization", () => {
  it("hides a channel-scoped file from a member who cannot view the channel", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "uploader" }, { userId: "blocked" }],
    });
    const channelId = await seedChannel(t, {
      overrides: [
        { targetId: "blocked", targetType: "member", allow: 0n, deny: Permission.ViewChannel },
      ],
    });
    const asUploader = t.withIdentity({ subject: "uploader" });
    const storageId = await storeBlob(t, 8);
    const fileId = await asUploader.action(api.files.finalize, {
      storageId,
      name: "secret",
      mime: "text/plain",
      sizeBytes: 8,
      channelId,
    });

    const asBlocked = t.withIdentity({ subject: "blocked" });
    await expect(asBlocked.query(api.files.get, { fileId })).rejects.toThrow("do not have access");
    expect(await asBlocked.query(api.files.getMany, { fileIds: [fileId] })).toEqual([]);
    // The uploader (who can view the channel) still gets it.
    expect(await asUploader.query(api.files.get, { fileId })).toMatchObject({
      uploaderId: "uploader",
    });
  });

  it("limits an unchannelled file to its uploader", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "uploader" }, { userId: "other" }] });
    const asUploader = t.withIdentity({ subject: "uploader" });
    const storageId = await storeBlob(t, 8);
    const fileId = await asUploader.action(api.files.finalize, {
      storageId,
      name: "mine",
      mime: "text/plain",
      sizeBytes: 8,
    });

    expect(await asUploader.query(api.files.get, { fileId })).toMatchObject({
      uploaderId: "uploader",
    });
    const asOther = t.withIdentity({ subject: "other" });
    await expect(asOther.query(api.files.get, { fileId })).rejects.toThrow("do not have access");
    expect(await asOther.query(api.files.getMany, { fileIds: [fileId] })).toEqual([]);
  });

  it("re-validates the download token's user against current membership", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "uploader" }] });
    const channelId = await seedChannel(t);
    const asUploader = t.withIdentity({ subject: "uploader" });
    const storageId = await storeBlob(t, 8);
    const fileId = await asUploader.action(api.files.finalize, {
      storageId,
      name: "doc",
      mime: "text/plain",
      sizeBytes: 8,
      channelId,
    });
    const view = await asUploader.query(api.files.get, { fileId });
    const token = tokenFromUrl(view?.url ?? "");
    await expect(t.action(api.files.download, { token })).resolves.toBeDefined();

    // Kick the uploader: the previously minted token must stop working.
    await t.run(async (ctx) => {
      const members = await ctx.db.query("members").collect();
      const member = members.find((entry) => entry.userId === "uploader") ?? null;
      if (member !== null) {
        await ctx.db.delete(member._id);
      }
    });
    await expect(t.action(api.files.download, { token })).rejects.toThrow();
  });
});

describe("C5 / L4 workspace reads", () => {
  it("requires the instance admin for encryption key status", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asUser = t.withIdentity({ subject: "user-1" });
    await expect(asUser.query(api.encryptionKeys.status)).rejects.toThrow("Instance admin only");

    const asOwner = t.withIdentity({ subject: "owner-1" });
    const status = await asOwner.query(api.encryptionKeys.status);
    expect(status).toHaveProperty("activeKeyVersion");
  });
});
