import { Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { isSealed, openString } from "../convex/lib/sse";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

async function setup(everyonePermissions?: bigint) {
  const t = newTest();
  await seedWorkspace(t, {
    ...(everyonePermissions !== undefined ? { everyonePermissions } : {}),
    members: [{ userId: "user-1" }, { userId: "user-2" }],
  });
  const channelId = await seedChannel(t);
  const asUser1 = t.withIdentity({ subject: "user-1" });
  const messageId = await asUser1.mutation(api.messages.send, {
    channelId,
    body: "bWVzc2FnZQ==",
  });
  return { t, channelId, messageId, asUser1 };
}

describe("reactions.toggle", () => {
  it("adds then removes the same plaintext emoji", async () => {
    const { asUser1, messageId } = await setup();

    expect(await asUser1.mutation(api.reactions.toggle, { messageId, emoji: "👍" })).toEqual({
      added: true,
    });
    expect(await asUser1.mutation(api.reactions.toggle, { messageId, emoji: "👍" })).toEqual({
      added: false,
    });
  });

  it("stores the emoji sealed and lists it decrypted", async () => {
    const { t, messageId, asUser1 } = await setup();
    await asUser1.mutation(api.reactions.toggle, { messageId, emoji: "👍" });

    const rows = await t.run(async (ctx) =>
      (await ctx.db.query("reactions").collect()).filter((row) => row.messageId === messageId),
    );
    expect(rows).toHaveLength(1);
    expect(isSealed(rows[0]?.emojiCiphertext ?? "")).toBe(true);
    expect(rows[0]?.emojiCiphertext).not.toContain("👍");
    await expect(
      openString({ scope: "reaction", recordId: messageId }, rows[0]?.emojiCiphertext ?? ""),
    ).resolves.toBe("👍");

    const reactions = await asUser1.query(api.reactions.list, { messageId });
    expect(reactions).toEqual([{ id: rows[0]?._id, userId: "user-1", emoji: "👍" }]);
  });

  it("lists reactions by message for multiple users", async () => {
    const { t, messageId, asUser1 } = await setup();
    const asUser2 = t.withIdentity({ subject: "user-2" });
    await asUser1.mutation(api.reactions.toggle, { messageId, emoji: "🎉" });
    await asUser2.mutation(api.reactions.toggle, { messageId, emoji: "🎉" });

    const reactions = await asUser1.query(api.reactions.list, { messageId });
    expect(reactions).toHaveLength(2);
    expect(reactions.map((r) => r.userId).sort()).toEqual(["user-1", "user-2"]);
  });

  it("requires AddReactions", async () => {
    const { messageId, asUser1 } = await setup(
      Permission.ViewChannel | Permission.SendMessages | Permission.ReadHistory,
    );
    await expect(
      asUser1.mutation(api.reactions.toggle, { messageId, emoji: "👍" }),
    ).rejects.toThrow("Missing permission");
  });
});

describe("reactions.listForMessages", () => {
  it("batches reactions, dedupes ids and skips messages in unviewable channels", async () => {
    const { t, channelId, messageId, asUser1 } = await setup();
    const asUser2 = t.withIdentity({ subject: "user-2" });

    const secondMessageId = await asUser1.mutation(api.messages.send, {
      channelId,
      body: "c2Vjb25k",
    });
    await asUser1.mutation(api.reactions.toggle, { messageId, emoji: "👍" });
    await asUser2.mutation(api.reactions.toggle, { messageId, emoji: "🎉" });
    await asUser1.mutation(api.reactions.toggle, { messageId: secondMessageId, emoji: "👍" });

    // A private channel user-1 is not a member of; its message must be skipped.
    const privateChannelId = await seedChannel(t, { private: true, memberIds: ["user-2"] });
    const hiddenMessageId = await asUser2.mutation(api.messages.send, {
      channelId: privateChannelId,
      body: "aGlkZGVu",
    });
    await asUser2.mutation(api.reactions.toggle, { messageId: hiddenMessageId, emoji: "🔥" });

    const reactions = await asUser1.query(api.reactions.listForMessages, {
      messageIds: [messageId, messageId, secondMessageId, hiddenMessageId],
    });

    // `messageId` is passed twice but its two reactions appear exactly once each.
    expect(reactions).toHaveLength(3);
    expect(reactions.filter((r) => r.messageId === hiddenMessageId)).toHaveLength(0);
    const first = reactions.filter((r) => r.messageId === messageId);
    expect(first.map((r) => r.emoji).sort()).toEqual(["🎉", "👍"]);
    expect(first.map((r) => r.userId).sort()).toEqual(["user-1", "user-2"]);
    expect(reactions.filter((r) => r.messageId === secondMessageId).map((r) => r.emoji)).toEqual([
      "👍",
    ]);
  });
});
