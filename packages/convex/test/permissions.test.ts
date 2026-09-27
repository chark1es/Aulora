import { Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import type { Test } from "./helpers";
import { newTest, seedChannel, seedWorkspace, storeBlob } from "./helpers";

/** Workspace where the caller has no ViewChannel and no send permissions. */
async function deniedSetup() {
  const t = newTest();
  await seedWorkspace(t, {
    everyonePermissions: Permission.ReadHistory,
    members: [{ userId: "user-1" }],
  });
  const channelId = await seedChannel(t);
  return { t, channelId, asUser1: t.withIdentity({ subject: "user-1" }) };
}

/** Workspace with send access but no moderation flags. */
async function senderSetup(t: Test) {
  await seedWorkspace(t, {
    everyonePermissions: Permission.ViewChannel | Permission.SendMessages | Permission.ReadHistory,
    members: [{ userId: "user-1" }, { userId: "user-2" }],
  });
  const channelId = await seedChannel(t);
  const asUser1 = t.withIdentity({ subject: "user-1" });
  const messageId = await asUser1.mutation(api.messages.send, {
    channelId,
    body: "bXNn",
  });
  return { t, channelId, messageId, asUser1, asUser2: t.withIdentity({ subject: "user-2" }) };
}

describe("permission denials", () => {
  it("channels.create needs ManageChannels", async () => {
    const { asUser1 } = await deniedSetup();
    await expect(
      asUser1.mutation(api.channels.create, { kind: "text", name: "chan" }),
    ).rejects.toThrow("Missing permission");
  });

  it("channels.rename/setTopic/archive/unarchive need ManageChannels", async () => {
    const { channelId, asUser1 } = await deniedSetup();
    await expect(
      asUser1.mutation(api.channels.rename, { channelId, name: "eA==" }),
    ).rejects.toThrow("Missing permission");
    await expect(
      asUser1.mutation(api.channels.setTopic, { channelId, topic: "eA==" }),
    ).rejects.toThrow("Missing permission");
    await expect(asUser1.mutation(api.channels.archive, { channelId })).rejects.toThrow(
      "Missing permission",
    );
    await expect(asUser1.mutation(api.channels.unarchive, { channelId })).rejects.toThrow(
      "Missing permission",
    );
  });

  it("channels.join and channels.get need ViewChannel", async () => {
    const { channelId, asUser1 } = await deniedSetup();
    await expect(asUser1.mutation(api.channels.join, { channelId })).rejects.toThrow(
      "Missing permission",
    );
    await expect(asUser1.query(api.channels.get, { channelId })).rejects.toThrow(
      "Missing permission",
    );
  });

  it("messages.send needs SendMessages", async () => {
    const { channelId, asUser1 } = await deniedSetup();
    await expect(asUser1.mutation(api.messages.send, { channelId, body: "eA==" })).rejects.toThrow(
      "Missing permission",
    );
  });

  it("threaded messages.send needs SendInThreads", async () => {
    const { channelId, messageId, asUser2 } = await senderSetup(newTest());
    await expect(
      asUser2.mutation(api.messages.send, {
        channelId,
        body: "eA==",
        threadRootId: messageId,
      }),
    ).rejects.toThrow("Missing permission");
  });

  it("messages.edit and messages.remove need author or ManageMessages", async () => {
    const { t, messageId } = await senderSetup(newTest());
    const asUser2 = t.withIdentity({ subject: "user-2" });
    await expect(asUser2.mutation(api.messages.edit, { messageId, body: "eA==" })).rejects.toThrow(
      "Missing permission",
    );
    await expect(asUser2.mutation(api.messages.remove, { messageId })).rejects.toThrow(
      "Missing permission",
    );
  });

  it("messages.pin and messages.unpin need PinMessages", async () => {
    const { messageId, asUser1 } = await senderSetup(newTest());
    await expect(asUser1.mutation(api.messages.pin, { messageId })).rejects.toThrow(
      "Missing permission",
    );
    await expect(asUser1.mutation(api.messages.unpin, { messageId })).rejects.toThrow(
      "Missing permission",
    );
  });

  it("reactions.toggle needs AddReactions", async () => {
    const { messageId, asUser1 } = await senderSetup(newTest());
    await expect(
      asUser1.mutation(api.reactions.toggle, { messageId, emoji: "eA==" }),
    ).rejects.toThrow("Missing permission");
  });

  it("files.generateUploadUrl and files.finalize need AttachFiles", async () => {
    const { t, asUser1 } = await deniedSetup();
    await expect(asUser1.mutation(api.files.generateUploadUrl, {})).rejects.toThrow(
      "Missing permission",
    );
    const storageId = await storeBlob(t, 8);
    await expect(
      asUser1.action(api.files.finalize, {
        storageId,
        name: "nope",
        mime: "text/plain",
        sizeBytes: 8,
      }),
    ).rejects.toThrow("Missing permission");
  });

  it("typing.set and typing.clear need ViewChannel", async () => {
    const { channelId, asUser1 } = await deniedSetup();
    await expect(asUser1.mutation(api.typing.set, { channelId })).rejects.toThrow(
      "Missing permission",
    );
    await expect(asUser1.mutation(api.typing.clear, { channelId })).rejects.toThrow(
      "Missing permission",
    );
  });

  it("readStates.set and readStates.get need ViewChannel", async () => {
    const { channelId, asUser1 } = await deniedSetup();
    await expect(asUser1.mutation(api.readStates.set, { channelId })).rejects.toThrow(
      "Missing permission",
    );
    await expect(asUser1.query(api.readStates.get, { channelId })).rejects.toThrow(
      "Missing permission",
    );
  });
});
