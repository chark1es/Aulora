import { Permission } from "@aulora/core";
import { expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { sealString } from "../convex/lib/sse";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

it("opens a pinned message outside the live tail with ordered nearby history", async () => {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "alice" }] });
  const channelId = await seedChannel(t);
  const ids = await t.run(async (ctx) => {
    const created = [];
    for (let i = 0; i < 130; i++)
      created.push(
        await ctx.db.insert("messages", {
          channelId,
          authorId: "alice",
          ciphertext: await sealString({ scope: "message", recordId: channelId }, `Message ${i}`),
          attachmentIds: [],
          mentionUserIds: [],
        }),
      );
    return created;
  });
  const messageId = ids[5];
  if (messageId === undefined) throw new Error("Missing test message");
  const user = t.withIdentity({ subject: "alice" });
  const tail = await user.query(api.messages.list, {
    channelId,
    paginationOpts: { cursor: null, numItems: 100 },
  });
  expect(tail.page.some((message) => message.id === messageId)).toBe(false);
  const result = await user.query(api.messages.context, { messageId });
  expect(result?.message.body).toBe("Message 5");
  expect(result?.history[0]?.body).toBe("Message 0");
  expect(result?.history.at(-1)?.body).toBe("Message 25");
});

it("enforces channel access and read history before opening a message", async () => {
  const t = newTest();
  await seedWorkspace(t, {
    members: [{ userId: "alice" }, { userId: "bob" }],
    everyonePermissions: Permission.ViewChannel | Permission.SendMessages,
  });
  const channelId = await seedChannel(t, { private: true, memberIds: ["alice"] });
  const alice = t.withIdentity({ subject: "alice" });
  const messageId = await alice.mutation(api.messages.send, { channelId, body: "Private message" });
  await expect(
    t.withIdentity({ subject: "bob" }).query(api.messages.context, { messageId }),
  ).rejects.toThrow();
  await expect(alice.query(api.messages.context, { messageId })).rejects.toThrow();
});

it("resolves a thread pin to its root and does not open deleted targets", async () => {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "alice" }] });
  const channelId = await seedChannel(t);
  const user = t.withIdentity({ subject: "alice" });
  const root = await user.mutation(api.messages.send, { channelId, body: "Root" });
  const reply = await user.mutation(api.messages.send, {
    channelId,
    body: "Reply",
    threadRootId: root,
  });
  const result = await user.query(api.messages.context, { messageId: reply });
  expect(result?.root.id).toBe(root);
  expect(result?.message.id).toBe(reply);
  expect(result?.history.map((message) => message.id)).toEqual([root]);
  await user.mutation(api.messages.remove, { messageId: reply });
  expect(await user.query(api.messages.context, { messageId: reply })).toBeNull();
});
