import { describe, expect, it } from "vitest";
import { internal } from "../convex/_generated/api";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

describe("account deletion cleanup", () => {
  it("removes the user's membership and personal rows but keeps workspace history", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "u1" }, { userId: "u2" }] });
    const channelId = await seedChannel(t);

    await t.run(async (ctx) => {
      const messageId = await ctx.db.insert("messages", {
        channelId,
        authorId: "u1",
        ciphertext: "sealed",
        attachmentIds: [],
        mentionUserIds: [],
      });
      await ctx.db.insert("channelMembers", {
        channelId,
        userId: "u1",
        joinedAt: 1,
      });
      await ctx.db.insert("channelMembers", {
        channelId,
        userId: "u2",
        joinedAt: 1,
      });
      await ctx.db.insert("devices", { userId: "u1", platform: "ios", lastSeen: 1 });
      await ctx.db.insert("presence", { userId: "u1", status: "online", lastHeartbeat: 1 });
      await ctx.db.insert("readStates", { userId: "u1", channelId, mentionCount: 0 });
      await ctx.db.insert("notificationPrefs", {
        userId: "u1",
        scope: "server",
        level: "all",
      });
      await ctx.db.insert("threadParticipants", {
        userId: "u1",
        threadRootId: messageId,
        channelId,
        lastReplyAt: 1,
        mentioned: false,
      });
      await ctx.db.insert("reactions", {
        messageId,
        userId: "u1",
        emojiCiphertext: "sealed",
      });
      await ctx.db.insert("userNotes", {
        authorId: "u1",
        targetUserId: "u2",
        bodyCiphertext: "sealed",
        updatedAt: 1,
      });
      await ctx.db.insert("userNotes", {
        authorId: "u2",
        targetUserId: "u1",
        bodyCiphertext: "sealed",
        updatedAt: 1,
      });
      await ctx.db.insert("kanbanGithub", { userId: "u1", tokenCiphertext: "sealed" });
    });

    await t.mutation(internal.accountDeletion.deleteUserData, { userId: "u1" });

    const left = await t.run(async (ctx) => ({
      members: await ctx.db.query("members").collect(),
      channelMembers: await ctx.db.query("channelMembers").collect(),
      devices: await ctx.db.query("devices").collect(),
      presence: await ctx.db.query("presence").collect(),
      readStates: await ctx.db.query("readStates").collect(),
      notificationPrefs: await ctx.db.query("notificationPrefs").collect(),
      threadParticipants: await ctx.db.query("threadParticipants").collect(),
      reactions: await ctx.db.query("reactions").collect(),
      userNotes: await ctx.db.query("userNotes").collect(),
      kanbanGithub: await ctx.db.query("kanbanGithub").collect(),
      messages: await ctx.db.query("messages").collect(),
    }));

    expect(left.members.map((row) => row.userId)).toEqual(["u2"]);
    expect(left.channelMembers.map((row) => row.userId)).toEqual(["u2"]);
    expect(left.devices).toHaveLength(0);
    expect(left.presence).toHaveLength(0);
    expect(left.readStates).toHaveLength(0);
    expect(left.notificationPrefs).toHaveLength(0);
    expect(left.threadParticipants).toHaveLength(0);
    expect(left.reactions).toHaveLength(0);
    expect(left.userNotes).toHaveLength(0);
    expect(left.kanbanGithub).toHaveLength(0);
    // Shared workspace history survives the account.
    expect(left.messages).toHaveLength(1);
  });

  it("is idempotent when the rows are already gone", async () => {
    const t = newTest();
    await seedWorkspace(t);
    await t.mutation(internal.accountDeletion.deleteUserData, { userId: "missing" });
  });
});
