import { Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

async function setup() {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
  const channelId = await seedChannel(t);
  const asUser1 = t.withIdentity({ subject: "user-1" });
  const send = (mentionUserIds: string[] = []) =>
    asUser1.mutation(api.messages.send, {
      channelId,
      ciphertext: "bXNn",
      epoch: 0,
      mentionUserIds,
    });
  return { t, channelId, asUser1, send };
}

describe("readStates.set", () => {
  it("counts mentions strictly after the cursor", async () => {
    const { channelId, asUser1, send } = await setup();
    const m1 = await send();
    await send(["user-1"]);
    await send();
    const m4 = await send(["user-1"]);

    const atStart = await asUser1.mutation(api.readStates.set, {
      channelId,
      lastReadMessageId: m1,
    });
    expect(atStart.mentionCount).toBe(2);

    const atEnd = await asUser1.mutation(api.readStates.set, {
      channelId,
      lastReadMessageId: m4,
    });
    expect(atEnd.mentionCount).toBe(0);
  });

  it("ignores deleted messages when counting mentions", async () => {
    const { channelId, asUser1, send } = await setup();
    const m1 = await send();
    const m2 = await send(["user-1"]);
    await asUser1.mutation(api.messages.remove, { messageId: m2 });

    const result = await asUser1.mutation(api.readStates.set, {
      channelId,
      lastReadMessageId: m1,
    });
    expect(result.mentionCount).toBe(0);
  });

  it("does not count mentions for other users", async () => {
    const { channelId, asUser1, send } = await setup();
    const m1 = await send();
    await send(["user-2"]);

    const result = await asUser1.mutation(api.readStates.set, {
      channelId,
      lastReadMessageId: m1,
    });
    expect(result.mentionCount).toBe(0);
  });

  it("returns null before a cursor is set and the state afterwards", async () => {
    const { channelId, asUser1, send } = await setup();
    expect(await asUser1.query(api.readStates.get, { channelId })).toBeNull();
    const m1 = await send(["user-1"]);
    await asUser1.mutation(api.readStates.set, { channelId, lastReadMessageId: m1 });
    expect(await asUser1.query(api.readStates.get, { channelId })).toEqual({
      channelId,
      lastReadMessageId: m1,
      mentionCount: 0,
    });
  });

  it("requires ViewChannel", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ReadHistory,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t);
    const asUser1 = t.withIdentity({ subject: "user-1" });
    await expect(asUser1.mutation(api.readStates.set, { channelId })).rejects.toThrow(
      "Missing permission",
    );
  });
});
