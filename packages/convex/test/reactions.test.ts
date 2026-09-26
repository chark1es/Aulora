import { Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
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
    ciphertext: "bWVzc2FnZQ==",
    epoch: 0,
  });
  return { t, channelId, messageId, asUser1 };
}

describe("reactions.toggle", () => {
  it("adds then removes with the same opaque ciphertext", async () => {
    const { asUser1, messageId } = await setup();

    expect(
      await asUser1.mutation(api.reactions.toggle, {
        messageId,
        emojiCiphertext: "ZW1vamk=",
      }),
    ).toEqual({ added: true });
    expect(
      await asUser1.mutation(api.reactions.toggle, {
        messageId,
        emojiCiphertext: "ZW1vamk=",
      }),
    ).toEqual({ added: false });
  });

  it("lists reactions by message", async () => {
    const { t, messageId, asUser1 } = await setup();
    const asUser2 = t.withIdentity({ subject: "user-2" });
    await asUser1.mutation(api.reactions.toggle, { messageId, emojiCiphertext: "ZW1vamk=" });
    await asUser2.mutation(api.reactions.toggle, { messageId, emojiCiphertext: "ZW1vamk=" });

    const reactions = await asUser1.query(api.reactions.list, { messageId });
    expect(reactions).toHaveLength(2);
    expect(reactions.map((r) => r.userId).sort()).toEqual(["user-1", "user-2"]);
  });

  it("requires AddReactions", async () => {
    const { messageId, asUser1 } = await setup(
      Permission.ViewChannel | Permission.SendMessages | Permission.ReadHistory,
    );
    await expect(
      asUser1.mutation(api.reactions.toggle, { messageId, emojiCiphertext: "ZW1vamk=" }),
    ).rejects.toThrow("Missing permission");
  });
});
